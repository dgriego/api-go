package main

import (
  "net/http"
  "handler/handler"

  now "github.com/zeit/now-builders/utils/go/bridge"
)

func main() {
  now.Start(http.HandlerFunc(handler.Handler))
}
