// start-navigation is the image's default command. The separate updater has
// its own command and never passes through this launcher.
package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"syscall"
)

const appID = 10001

// Operate on open descriptors so ownership changes cannot follow a replaced
// path. Only the mount directory and SQLite's own regular files are adjusted.
func prepare(fd int, directory bool) error {
	var info syscall.Stat_t
	if err := syscall.Fstat(fd, &info); err != nil {
		return err
	}
	required := uint32(0600)
	if directory {
		required = 0700
	} else if info.Mode&syscall.S_IFMT != syscall.S_IFREG || info.Nlink != 1 {
		return errors.New("expected a regular SQLite file with one link")
	}
	if info.Uid != appID || info.Gid != appID {
		if err := syscall.Fchown(fd, appID, appID); err != nil {
			return err
		}
	}
	if info.Mode&required != required {
		return syscall.Fchmod(fd, info.Mode&0777|required)
	}
	return nil
}

func prepareData() error {
	dir, err := syscall.Open("/data", syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return err
	}
	defer syscall.Close(dir)
	if err := prepare(dir, true); err != nil {
		return err
	}
	for _, name := range []string{"navigation.db", "navigation.db-wal", "navigation.db-shm", "navigation.db-journal"} {
		fd, err := syscall.Openat(dir, name, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
		if errors.Is(err, syscall.ENOENT) {
			continue
		}
		if err == nil {
			err = prepare(fd, false)
			syscall.Close(fd)
		}
		if err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	return nil
}

func main() {
	if os.Geteuid() == 0 {
		if os.Getenv("DB_PATH") == "/data/navigation.db" {
			if err := prepareData(); err != nil {
				log.Fatalf("cannot prepare /data: %v (mount a writable dedicated folder for UID/GID 10001:10001)", err)
			}
		}
		if err := syscall.Setgroups(nil); err != nil {
			log.Fatal(err)
		}
		if err := syscall.Setgid(appID); err != nil {
			log.Fatal(err)
		}
		if err := syscall.Setuid(appID); err != nil {
			log.Fatal(err)
		}
	}
	log.Fatal(syscall.Exec("/app/navigation", append([]string{"/app/navigation"}, os.Args[1:]...), os.Environ()))
}
