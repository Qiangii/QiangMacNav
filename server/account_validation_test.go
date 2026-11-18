package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestAccountValidationSharedCases(t *testing.T) {
	raw, err := os.ReadFile("../testdata/account-validation.json")
	if err != nil {
		t.Fatal(err)
	}
	var groups map[string][]struct {
		Value, Suffix string
		Repeat        int
		Valid         bool
	}
	if err = json.Unmarshal(raw, &groups); err != nil {
		t.Fatal(err)
	}
	for name, validate := range map[string]func(string) bool{"usernames": validUsername, "passwords": validPassword, "passwordLengths": validPasswordLength} {
		for _, item := range groups[name] {
			repeat := item.Repeat
			if repeat == 0 {
				repeat = 1
			}
			value := strings.Repeat(item.Value, repeat) + item.Suffix
			if got := validate(value); got != item.Valid {
				t.Errorf("%s %q: got %v", name, value, got)
			}
		}
	}
	if validPassword("abc12\xff") {
		t.Fatal("invalid UTF-8 accepted")
	}
	if validUsername("中文账号\xff") {
		t.Fatal("invalid UTF-8 username accepted")
	}
}

func TestOptionalSetupToken(t *testing.T) {
	for _, token := range []string{"", "configured-secret"} {
		t.Run(fmt.Sprintf("configured=%t", token != ""), func(t *testing.T) {
			a, h := testApp(t)
			a.setupToken = token
			var boot struct{ SetupRequired, SetupTokenRequired bool }
			w := request(t, h, "GET", "/api/bootstrap", nil, nil)
			if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &boot) != nil || !boot.SetupRequired || boot.SetupTokenRequired != (token != "") {
				t.Fatal(w.Body)
			}
			if token != "" && bytes.Contains(w.Body.Bytes(), []byte(token)) {
				t.Fatal("bootstrap exposed setup secret")
			}
			body := map[string]string{"name": "First Admin", "username": "Admin", "password": "Abc123"}
			if token != "" {
				for _, supplied := range []string{"", "wrong-secret"} {
					body["setupToken"] = supplied
					if w = request(t, h, "POST", "/api/auth/register", body, nil); w.Code != 403 {
						t.Fatal("incorrect setup key accepted", w.Body)
					}
				}
				body["setupToken"] = token
			}
			w = request(t, h, "POST", "/api/auth/register", body, nil)
			if w.Code != 201 || !bytes.Contains(w.Body.Bytes(), []byte(`"role":"admin"`)) {
				t.Fatal(w.Body)
			}
			w = request(t, h, "GET", "/api/bootstrap", nil, nil)
			if json.Unmarshal(w.Body.Bytes(), &boot) != nil || boot.SetupRequired || boot.SetupTokenRequired {
				t.Fatal("setup remains required", w.Body)
			}
			body["username"] = "Member"
			delete(body, "setupToken")
			w = request(t, h, "POST", "/api/auth/register", body, nil)
			if w.Code != 201 || !bytes.Contains(w.Body.Bytes(), []byte(`"role":"user"`)) {
				t.Fatal("ordinary registration required setup key or gained admin", w.Body)
			}
		})
	}
}

func TestPasswordRulesAcrossAccountEndpoints(t *testing.T) {
	a, h := testApp(t)
	a.setupToken = ""
	admin := registerTestUser(t, h, "admin", "")
	member := registerTestUser(t, h, "member", "")
	var memberID string
	if err := a.db.QueryRow("SELECT id FROM users WHERE username='member'").Scan(&memberID); err != nil {
		t.Fatal(err)
	}
	for _, password := range []string{"abc12", strings.Repeat("a", 16) + "1"} {
		if w := request(t, h, "POST", "/api/auth/login", map[string]string{"username": "member", "password": password}, nil); w.Code != 400 {
			t.Fatal("invalid login password length accepted", w.Body)
		}
		if w := request(t, h, "PUT", "/api/account/password", map[string]string{"currentPassword": password, "newPassword": "Abc123"}, member); w.Code != 400 {
			t.Fatal("invalid current password length accepted", w.Body)
		}
	}
	for _, password := range []string{"abc12", "123456", "abcdef", "!!!!!!", strings.Repeat("a", 16) + "1", strings.Repeat("🔐", 16) + "1"} {
		register := request(t, h, "POST", "/api/auth/register", map[string]string{"name": "Invalid User", "username": "invalid", "password": password}, nil)
		change := request(t, h, "PUT", "/api/account/password", map[string]string{"currentPassword": testPassword, "newPassword": password}, member)
		reset := request(t, h, "PATCH", "/api/admin/users/"+memberID, map[string]string{"password": password}, admin)
		for _, response := range []struct {
			Status int
			Body   string
		}{{register.Code, register.Body.String()}, {change.Code, change.Body.String()}, {reset.Code, reset.Body.String()}} {
			if response.Status != 400 || !strings.Contains(response.Body, passwordHint) {
				t.Fatalf("invalid password accepted or wrong hint: %+v", response)
			}
		}
	}
	if w := request(t, h, "PUT", "/api/account/password", map[string]string{"currentPassword": testPassword, "newPassword": "Abc123"}, member); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w := request(t, h, "POST", "/api/auth/login", map[string]string{"username": "MEMBER", "password": "Abc123"}, nil); w.Code != 200 {
		t.Fatal(w.Body)
	}
	// The 16-character limit counts Unicode code points, not bytes or UTF-16
	// units, and the final character participates in password verification.
	long := strings.Repeat("🔐", 15) + "1"
	w := request(t, h, "POST", "/api/auth/register", map[string]string{"name": "Unicode User", "username": "中文账号!", "password": long}, nil)
	if w.Code != 400 {
		t.Fatal("username with punctuation accepted")
	}
	w = request(t, h, "POST", "/api/auth/register", map[string]string{"name": "Unicode User", "username": "unicode", "password": long}, nil)
	if w.Code != 201 {
		t.Fatal(w.Body)
	}
	unicodeCookie := w.Result().Cookies()[0]
	if w = request(t, h, "POST", "/api/auth/login", map[string]string{"username": "unicode", "password": strings.Repeat("🔐", 15) + "2"}, nil); w.Code != 401 {
		t.Fatal("password suffix was ignored", w.Body)
	}
	if w = request(t, h, "POST", "/api/auth/login", map[string]string{"username": "unicode", "password": long}, nil); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w = request(t, h, "PUT", "/api/account/password", map[string]string{"currentPassword": long, "newPassword": "秘密🔐123"}, unicodeCookie); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w = request(t, h, "POST", "/api/auth/login", map[string]string{"username": "unicode", "password": "秘密🔐123"}, nil); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w = request(t, h, "PATCH", "/api/admin/users/"+memberID, map[string]string{"password": long}, admin); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w = request(t, h, "POST", "/api/auth/login", map[string]string{"username": "member", "password": long}, nil); w.Code != 200 {
		t.Fatal(w.Body)
	}
}
