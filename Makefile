.PHONY: up down logs shell ps nuke env dist clean-dist

PLUGIN_KEY     := kbhint
PLUGIN_VERSION := $(shell awk -F"'" '/PLUGIN_KBHINT_VERSION/ {print $$4; exit}' plugin/setup.php)
DIST_DIR       := dist
TARBALL        := $(DIST_DIR)/$(PLUGIN_KEY)-$(PLUGIN_VERSION).tar.bz2

env:
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example")

up: env
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f glpi

ps:
	docker compose ps

shell:
	docker compose exec glpi bash

nuke:
	docker compose down -v

dist: clean-dist
	@mkdir -p $(DIST_DIR)
	tar --transform 's,^plugin,$(PLUGIN_KEY),' \
	    --transform 's,^LICENSE$$,$(PLUGIN_KEY)/LICENSE,' \
	    --exclude='.DS_Store' --exclude='*.swp' --exclude='*.bak' \
	    -cjf $(TARBALL) plugin LICENSE
	@echo "Built $(TARBALL)"
	@tar -tjf $(TARBALL) | head -20

clean-dist:
	rm -rf $(DIST_DIR)
