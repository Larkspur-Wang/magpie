package update

import "testing"

// The Mirasim edition is built as mirasim-<upstream tag>+<commit>
// (build/mirasim-app.sh). Were that a release, the official updater would
// swap the edition for the official app; an upstream change to Released
// that would do so fails here when it is merged.
func TestMirasimEditionNeverSelfUpdates(t *testing.T) {
	for _, v := range []string{"mirasim-v0.1.550+1348811", "mirasim-v0.1.550+1348811-dirty", "mirasim-dev-1348811"} {
		if Released(v) {
			t.Errorf("Released(%q) = true: the official updater would replace the Mirasim edition", v)
		}
	}
}
