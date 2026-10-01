package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/agent"
	"github.com/yetone/magpie/internal/mirasim"
	"github.com/yetone/magpie/internal/proc"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
)

func mirasimCmd(args []string) error {
	s := settings.Load()
	if len(args) == 0 {
		fmt.Printf("Mirasim provider: %t\nClaude launcher: %s\n", s.Mirasim, claudeLauncher(s))
		_, err := mirasim.Resolve()
		return err
	}
	if len(args) != 1 {
		return fmt.Errorf("usage: magpie mirasim [on|off|sync]")
	}
	switch args[0] {
	case "on", "sync":
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		ms, err := provider.RefreshMirasim(ctx)
		if err != nil {
			return err
		}
		if args[0] == "on" {
			s.Mirasim, s.ClaudeLauncher = true, "mirasim"
			if err := settings.Save(s); err != nil {
				return err
			}
		}
		fmt.Printf("Mirasim: %d models from the native Claude CLI; launcher %s\n", len(ms), claudeLauncher(settings.Load()))
		return nil
	case "off":
		// Keep the provider's catalog and picks for the next enable.
		s.Mirasim, s.ClaudeLauncher = false, ""
		return settings.Save(s)
	default:
		return fmt.Errorf("usage: magpie mirasim [on|off|sync]")
	}
}

func claudeLauncher(s settings.Settings) string {
	if s.ClaudeLauncher == "mirasim" {
		return "mirasim claude"
	}
	return "claude"
}

func launchCmd(args []string) error {
	if len(args) == 0 || args[0] != "claude" {
		return fmt.Errorf("usage: magpie launch claude [Claude Code arguments...]")
	}
	binary, rest := "claude", args[1:]
	if settings.Load().ClaudeLauncher == "mirasim" {
		a, err := agent.Find("claude")
		if err != nil {
			return err
		}
		if warning := a.Check(); warning != "" {
			return fmt.Errorf("%s", warning)
		}
		c, err := mirasim.Resolve()
		if err != nil {
			return err
		}
		hasModel := false
		for _, arg := range rest {
			if arg == "--" {
				break
			}
			hasModel = hasModel || arg == "--model" || arg == "-m" || strings.HasPrefix(arg, "--model=") || arg == "--resume" || arg == "-r" || strings.HasPrefix(arg, "--resume=") || arg == "--continue" || arg == "-c"
		}
		if !hasModel {
			if m := a.Field("model").Get(); m != "" {
				rest = append([]string{"--model", m}, rest...)
			}
		}
		binary, rest = c.Binary, c.With(append([]string{"claude"}, rest...)...)
	}
	cmd := proc.Command(binary, rest...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	return cmd.Run()
}
