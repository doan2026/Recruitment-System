package middleware

import (
	"net/http"
	"sync"
	"time"
)

type clientRecord struct {
	lastSeen time.Time
	count    int
}

type RateLimiter struct {
	sync.Mutex
	clients map[string]*clientRecord
	rate    int           // requests allowed
	window  time.Duration // in timeframe
}

func NewRateLimiter(rate int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		clients: make(map[string]*clientRecord),
		rate:    rate,
		window:  window,
	}

	go func() {
		for {
			time.Sleep(window)
			rl.Lock()
			now := time.Now()
			for ip, client := range rl.clients {
				if now.Sub(client.lastSeen) > rl.window {
					delete(rl.clients, ip)
				}
			}
			rl.Unlock()
		}
	}()

	return rl
}

func (rl *RateLimiter) Limit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			ip = xff
		}

		rl.Lock()
		client, exists := rl.clients[ip]
		if !exists || time.Since(client.lastSeen) > rl.window {
			rl.clients[ip] = &clientRecord{lastSeen: time.Now(), count: 1}
			rl.Unlock()
			next.ServeHTTP(w, r)
			return
		}

		if client.count >= rl.rate {
			rl.Unlock()
			http.Error(w, `{"error":"too many requests"}`, http.StatusTooManyRequests)
			return
		}

		client.count++
		client.lastSeen = time.Now()
		rl.Unlock()

		next.ServeHTTP(w, r)
	})
}
