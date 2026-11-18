package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestUsernameRegistration(t *testing.T) {
	for _, item := range []struct {
		name  string
		valid bool
	}{
		{"abcde", true}, {"12345", true}, {"AbC123", true},
		{"Ab1", true}, {"123", true}, {"1234", true}, {"中文名", true}, {"中A1", true},
		{strings.Repeat("𠮷", 3), true}, {"中文账号", true},
		{"abcdefghijk", true}, {"AbCd123456789012", true}, {"1234567890123456", true},
		{"中文账号名", true}, {"繁體帳號名", true}, {"中文Ab1", true},
		{strings.Repeat("中", 16), true}, {strings.Repeat("𠮷", 16), true},
		{"", false}, {"a", false}, {"Ab", false}, {"12", false}, {"AbCd1234567890123", false},
		{"中文", false}, {strings.Repeat("𠮷", 2), false}, {strings.Repeat("中", 17), false}, {strings.Repeat("𠮷", 17), false},
		{"abc_def", false}, {"中文 账号名", false}, {"中文账号😀", false}, {"abc@example.com", false}, {"abcdef!", false},
	} {
		t.Run(item.name, func(t *testing.T) {
			name := item.name
			_, h := testApp(t)
			w := request(t, h, "POST", "/api/auth/register", map[string]string{"name": "Test user", "username": name, "password": testPassword, "setupToken": "setup-secret"}, nil)
			if !item.valid {
				if w.Code != 400 || !strings.Contains(w.Body.String(), usernameHint) {
					t.Fatalf("expected invalid account: %d", w.Code)
				}
				return
			}
			if w.Code != 201 {
				t.Fatalf("register: %d %s", w.Code, w.Body.String())
			}
			w = request(t, h, "POST", "/api/auth/login", map[string]string{"username": name, "password": testPassword}, nil)
			if w.Code != 200 {
				t.Fatalf("login: %d %s", w.Code, w.Body.String())
			}
			var u user
			if err := json.Unmarshal(w.Body.Bytes(), &u); err != nil || u.Username != strings.ToLower(name) {
				t.Fatal("missing username")
			}
			w = request(t, h, "POST", "/api/auth/register", map[string]string{"name": "Test user", "username": u.Username, "password": testPassword}, nil)
			if w.Code != 409 {
				t.Fatalf("duplicate: %d", w.Code)
			}
		})
	}
}

func TestUsernameLoginContract(t *testing.T) {
	_, h := testApp(t)
	registerTestUser(t, h, "MixedCase", "setup-secret")
	w := request(t, h, "POST", "/api/auth/login", map[string]string{"username": "MIXEDCASE", "password": testPassword}, nil)
	if w.Code != 200 {
		t.Fatalf("case insensitive login: %d %s", w.Code, w.Body)
	}
	w = request(t, h, "POST", "/api/auth/login", map[string]string{"email": "MixedCase", "password": testPassword}, nil)
	if w.Code != 400 {
		t.Fatal("removed email field accepted")
	}
}

func TestHanUsernameNormalization(t *testing.T) {
	_, h := testApp(t)
	registerTestUser(t, h, " 中文Ab1 ", "setup-secret")
	w := request(t, h, "POST", "/api/auth/login", map[string]string{"username": " 中文aB1 ", "password": testPassword}, nil)
	var u user
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &u) != nil || u.Username != "中文ab1" {
		t.Fatalf("mixed Han username login: %d %s", w.Code, w.Body)
	}
	w = request(t, h, "POST", "/api/auth/register", map[string]string{"name": "Duplicate user", "username": "中文AB1", "password": testPassword}, nil)
	if w.Code != 409 {
		t.Fatalf("case variant duplicate: %d %s", w.Code, w.Body)
	}
}
