COMPOSE := docker compose
DEV_COMPOSE := docker compose --env-file .env.dev -f compose.yaml -f compose.dev.yaml

.PHONY: env doctor dev dev\:frontend dev\:backend down check backup restore migrate

dev:
	bash scripts/dev.sh

env:
	bash scripts/env.sh

doctor dev dev\:frontend dev\:backend down: env

doctor:
	bash scripts/doctor.sh

dev\:frontend:
	bash scripts/dev-frontend.sh

dev\:backend:
	bash scripts/dev-backend.sh

down:
	$(DEV_COMPOSE) --profile production down

check:
	bash -n scripts/*.sh deployables/backup/*.sh
	bash deployables/backup/test-backup-lock.sh
	bash deployables/backup/test-restore-safety.sh
	cd server && go test -race ./... && go vet ./...
	cd web && npm ci && npm run typecheck && npm test -- --run && npm run build
	node scripts/check-contract.mjs

migrate:
	$(COMPOSE) run --rm --no-deps portal migrate

backup:
	$(COMPOSE) --profile production run --rm --no-deps -e BACKUP_ONCE=1 backup

restore:
	@test -n "$(RESTORE_SNAPSHOT)" -a -n "$(RESTORE_DATABASE_URL)" -a -n "$(RESTORE_UPLOAD_DIR)" -a -n "$(RESTORE_ACK)" || (echo 'Set RESTORE_SNAPSHOT, RESTORE_DATABASE_URL, RESTORE_UPLOAD_DIR and RESTORE_ACK explicitly' >&2; exit 2)
	@case "$(RESTORE_UPLOAD_DIR)" in /*) ;; *) echo 'RESTORE_UPLOAD_DIR must be absolute' >&2; exit 2 ;; esac
	@test "$(RESTORE_UPLOAD_DIR)" != / && test -d "$(RESTORE_UPLOAD_DIR)" || (echo 'Create an explicit restore directory first' >&2; exit 2)
	$(COMPOSE) --profile production run --rm --no-deps --user 0:0 --entrypoint /bin/bash --volume "$(RESTORE_UPLOAD_DIR):/restore-target" -e RESTORE_SNAPSHOT -e RESTORE_DATABASE_URL -e RESTORE_ACK -e RESTORE_UPLOAD_DIR=/restore-target backup /usr/local/bin/restore.sh

hooks:
	git config core.hooksPath .githooks
