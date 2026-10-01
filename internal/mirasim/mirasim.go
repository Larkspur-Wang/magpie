// Package mirasim invokes the installed native CLI. Authentication and request
// signing stay in Mirasim; Magpie never reads or copies its credentials.
package mirasim

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/yetone/magpie/internal/proc"
)

type Command struct {
	Binary string
	Args   []string
}

func executable(path string) bool {
	s, err := os.Stat(path)
	return err == nil && !s.IsDir() && s.Mode()&0o111 != 0
}

// Resolve also supports the desktop app's updated runtime: a shell function
// called mirasim is not an executable visible to a GUI application's PATH.
func Resolve() (Command, error) {
	if path := os.Getenv("MAGPIE_MIRASIM_BIN"); path != "" {
		if !executable(path) {
			return Command{}, fmt.Errorf("MAGPIE_MIRASIM_BIN must name an executable")
		}
		return Command{Binary: path}, nil
	}
	if path, err := exec.LookPath("mirasim"); err == nil {
		return Command{Binary: path}, nil
	}
	home, _ := os.UserHomeDir()
	root := os.Getenv("MIRASIM_HOME")
	if root == "" {
		root = filepath.Join(home, ".mirasim")
	}
	var state struct {
		Good string `json:"good"`
	}
	if data, err := os.ReadFile(filepath.Join(root, "app", "state.json")); err == nil {
		_ = json.Unmarshal(data, &state)
	}
	var candidates []string
	if state.Good != "" && state.Good != "." && state.Good != ".." && filepath.Base(state.Good) == state.Good && !strings.ContainsAny(state.Good, `/\`) {
		candidates = append(candidates, filepath.Join(root, "app", state.Good, "server.cjs"))
	}
	candidates = append(candidates, "/Applications/Mirasim.app/Contents/Resources/server.cjs", filepath.Join(home, "Applications", "Mirasim.app", "Contents", "Resources", "server.cjs"))
	for _, path := range candidates {
		if s, err := os.Stat(path); err == nil && !s.IsDir() {
			node, err := exec.LookPath("node")
			if err != nil {
				return Command{}, fmt.Errorf("Mirasim's desktop runtime needs Node.js on PATH")
			}
			return Command{Binary: node, Args: []string{path}}, nil
		}
	}
	return Command{}, fmt.Errorf("Mirasim is not installed; install it and sign in with mirasim login")
}

func (c Command) With(args ...string) []string {
	return append(append([]string{}, c.Args...), args...)
}

func (c Command) Shell(args ...string) string {
	all := append([]string{c.Binary}, c.With(args...)...)
	for i, a := range all {
		all[i] = "'" + strings.ReplaceAll(a, "'", "'\"'\"'") + "'"
	}
	return strings.Join(all, " ")
}

type Model struct {
	ID            string `json:"id"`
	Label         string `json:"label"`
	ContextWindow int    `json:"contextWindow"`
}

type Catalog struct {
	Agent         string              `json:"agent"`
	Models        []Model             `json:"models"`
	EffortByModel map[string][]Effort `json:"effortByModel"`
}

type Effort struct {
	ID          string `json:"id"`
	Unavailable bool   `json:"unavailable"`
}

// ParseCatalog ignores the host's log lines, accepting only its catalog frame.
func ParseCatalog(data []byte) (Catalog, error) {
	s := bufio.NewScanner(bytes.NewReader(data))
	s.Buffer(make([]byte, 4096), 4<<20)
	offset := 0
	for s.Scan() {
		var c Catalog
		start := offset
		offset += len(s.Bytes()) + 1
		if !bytes.HasPrefix(bytes.TrimSpace(s.Bytes()), []byte("{")) {
			continue
		}
		// The CLI may pretty-print a frame over several lines.
		if json.NewDecoder(bytes.NewReader(data[start:])).Decode(&c) == nil && c.Agent == "claude" && len(c.Models) > 0 {
			for _, m := range c.Models {
				if strings.TrimSpace(m.ID) == "" {
					return Catalog{}, fmt.Errorf("Mirasim returned an empty model id")
				}
			}
			return c, nil
		}
	}
	return Catalog{}, fmt.Errorf("Mirasim did not return a Claude model catalog")
}

type boundedOutput struct{ bytes.Buffer }

func (b *boundedOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 4<<20 {
		return 0, fmt.Errorf("Mirasim output exceeded 4 MB")
	}
	return b.Buffer.Write(p)
}

func FetchCatalog(ctx context.Context) (Catalog, error) {
	c, err := Resolve()
	if err != nil {
		return Catalog{}, err
	}
	cmd := proc.CommandContext(ctx, c.Binary, c.With("ui-cli", "--timeout", "20000", "catalog", "--agent", "claude")...)
	cmd.Env = append(os.Environ(), "MIRASIM_QUIET=1")
	var out boundedOutput
	cmd.Stdout, cmd.Stderr = &out, &out
	if err := run(ctx, cmd); err != nil {
		// Do not propagate native diagnostics: they may include credentials.
		return Catalog{}, fmt.Errorf("Mirasim catalog command failed: %w", err)
	}
	return ParseCatalog(out.Bytes())
}

func Probe(ctx context.Context, model string) error {
	c, err := Resolve()
	if err != nil {
		return err
	}
	cmd := proc.CommandContext(ctx, c.Binary, c.With("claude", "--bare", "-p", "--output-format", "json", "--model", model,
		"--tools", "", "--setting-sources", "", "--no-session-persistence", "Reply exactly OK.")...)
	cmd.Env = append(os.Environ(), "MIRASIM_QUIET=1")
	var out boundedOutput
	cmd.Stdout, cmd.Stderr = &out, &out
	if err := run(ctx, cmd); err != nil {
		return fmt.Errorf("Mirasim generation command failed: %w", err)
	}
	s := bufio.NewScanner(bytes.NewReader(out.Bytes()))
	s.Buffer(make([]byte, 4096), 4<<20)
	for s.Scan() {
		var result struct {
			Type    string `json:"type"`
			IsError bool   `json:"is_error"`
			Result  string `json:"result"`
		}
		if json.Unmarshal(s.Bytes(), &result) == nil && result.Type == "result" {
			if result.IsError || strings.TrimSpace(result.Result) == "" {
				return fmt.Errorf("Mirasim generation was refused; inspect the native CLI for details")
			}
			return nil
		}
	}
	return fmt.Errorf("Mirasim returned no generation result")
}

func run(ctx context.Context, cmd *exec.Cmd) error {
	tree, err := proc.StartTree(cmd)
	if err != nil {
		return err
	}
	stop := context.AfterFunc(ctx, tree.Kill)
	err = tree.Wait()
	stop()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return err
}
