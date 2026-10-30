#!/bin/sh
set -eu

if [ "${1:-serve}" = serve ]; then
  portal migrate
  if [ "${APP_ENV:-production}" = development ] && [ "${SEED_DEVELOPMENT:-false}" = true ]; then
    portal seed
  fi
fi

if [ "$#" -eq 0 ]; then set -- serve; fi
exec portal "$@"
