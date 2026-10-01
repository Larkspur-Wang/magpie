package mirasim

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"

	"github.com/yetone/magpie/internal/proc"
)

// RelayStatus deliberately omits tokens, account identifiers and history.
type RelayStatus struct {
	Mode       string      `json:"mode"`
	Configured bool        `json:"configured"`
	Usage      *RelayUsage `json:"usage"`
	Login      struct {
		Plan    string `json:"plan"`
		PlanExp int64  `json:"planExp"`
	} `json:"login"`
}

type RelayUsage struct {
	OK         bool          `json:"ok"`
	Source     string        `json:"source"`
	CapturedAt string        `json:"capturedAt"`
	Windows    []RelayWindow `json:"windows"`
}

type RelayWindow struct {
	Label             string   `json:"label"`
	UsedPercent       *float64 `json:"usedPercent"`
	ResetAt           string   `json:"resetAt"`
	ResetAfterSeconds int64    `json:"resetAfterSeconds"`
	ModelScoped       bool     `json:"modelScoped"`
}

func ParseRelayStatus(data []byte) (RelayStatus, error) {
	s := bufio.NewScanner(bytes.NewReader(data))
	s.Buffer(make([]byte, 4096), 4<<20)
	offset := 0
	for s.Scan() {
		start := offset
		offset += len(s.Bytes()) + 1
		if !bytes.HasPrefix(bytes.TrimSpace(s.Bytes()), []byte("{")) {
			continue
		}
		var status RelayStatus
		if json.NewDecoder(bytes.NewReader(data[start:])).Decode(&status) == nil && status.Mode != "" {
			return status, nil
		}
	}
	return RelayStatus{}, fmt.Errorf("Mirasim returned no relay status")
}

func FetchRelayStatus(ctx context.Context) (RelayStatus, error) {
	c, err := Resolve()
	if err != nil {
		return RelayStatus{}, err
	}
	port := os.Getenv("MAGPIE_MIRASIM_PORT")
	if port == "" {
		port = "4970"
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return RelayStatus{}, fmt.Errorf("MAGPIE_MIRASIM_PORT must be a local host port")
	}
	// The one-shot host returns usage:null before its monitor starts. Attach
	// to the installed host instead; its native CLI owns the local access token.
	cmd := proc.CommandContext(ctx, c.Binary, c.With("ui-cli", "--port", port, "--timeout", "15000", "relay", "status")...)
	cmd.Env = append(os.Environ(), "MIRASIM_QUIET=1")
	var out boundedOutput
	cmd.Stdout, cmd.Stderr = &out, &out
	if err := run(ctx, cmd); err != nil {
		return RelayStatus{}, fmt.Errorf("Mirasim quota fetch failed; open its desktop app: %w", err)
	}
	return ParseRelayStatus(out.Bytes())
}
