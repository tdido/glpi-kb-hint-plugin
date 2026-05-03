.PHONY: up down logs shell ps nuke env

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
