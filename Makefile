# Makefile for building Docker images

# Variables
IMAGE_NAME ?= filesystem-mcp
VERSION ?= $(shell rg '"version"' src/filesystem/package.json | cut -d'"' -f4)
REGISTRY ?= ghcr.io
REPO_NAME ?= modelcontextprotocol/servers
TAG ?= $(VERSION)
FULL_IMAGE_NAME = $(REGISTRY)/$(REPO_NAME)/$(IMAGE_NAME)
DOCKERFILE = src/filesystem/Dockerfile
DOCKERFILE_TEST = src/filesystem/Dockerfile.test
TEST_IMAGE_NAME = $(IMAGE_NAME)-test
BUILD_CONTEXT = .

# Default target
.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: build
build: ## Build the Docker image
	@echo "Building $(FULL_IMAGE_NAME):$(TAG)..."
	docker build \
		--file $(DOCKERFILE) \
		--tag $(FULL_IMAGE_NAME):$(TAG) \
		--tag $(FULL_IMAGE_NAME):latest \
		--network host \
		$(BUILD_CONTEXT)
	@echo "Build complete: $(FULL_IMAGE_NAME):$(TAG)"

.PHONY: build-no-cache
build-no-cache: ## Build the Docker image without cache
	@echo "Building $(FULL_IMAGE_NAME):$(TAG) (no cache)..."
	docker build \
		--no-cache \
		--file $(DOCKERFILE) \
		--tag $(FULL_IMAGE_NAME):$(TAG) \
		--tag $(FULL_IMAGE_NAME):latest \
		--network host \
		$(BUILD_CONTEXT)
	@echo "Build complete: $(FULL_IMAGE_NAME):$(TAG)"

.PHONY: tag
tag: ## Tag the image with a specific version
	@if [ -z "$(NEW_TAG)" ]; then \
		echo "Error: NEW_TAG is required. Usage: make tag NEW_TAG=v1.0.0"; \
		exit 1; \
	fi
	docker tag $(FULL_IMAGE_NAME):$(TAG) $(FULL_IMAGE_NAME):$(NEW_TAG)
	@echo "Tagged $(FULL_IMAGE_NAME):$(TAG) as $(FULL_IMAGE_NAME):$(NEW_TAG)"

.PHONY: push
push: ## Push the Docker image to registry
	@echo "Pushing $(FULL_IMAGE_NAME):$(TAG)..."
	docker push $(FULL_IMAGE_NAME):$(TAG)
	docker push $(FULL_IMAGE_NAME):latest
	@echo "Push complete"

.PHONY: push-tag
push-tag: ## Push a specific tag
	@if [ -z "$(NEW_TAG)" ]; then \
		echo "Error: NEW_TAG is required. Usage: make push-tag NEW_TAG=v1.0.0"; \
		exit 1; \
	fi
	@echo "Pushing $(FULL_IMAGE_NAME):$(NEW_TAG)..."
	docker push $(FULL_IMAGE_NAME):$(NEW_TAG)
	@echo "Push complete"

.PHONY: run
run: ## Run the Docker container
	@echo "Running $(FULL_IMAGE_NAME):$(TAG)..."
	docker run --rm -it $(FULL_IMAGE_NAME):$(TAG)

.PHONY: test
test: test-docker ## Alias for test-docker

.PHONY: test-docker
test-docker: ## Run tests using Dockerfile.test
	@echo "Building test image..."
	docker build \
		--file $(DOCKERFILE_TEST) \
		--tag $(TEST_IMAGE_NAME):latest \
		--network host \
		$(BUILD_CONTEXT)
	@echo "Running tests..."
	docker run --rm $(TEST_IMAGE_NAME):latest

.PHONY: test-docker-no-cache
test-docker-no-cache: ## Run tests using Dockerfile.test without cache
	@echo "Building test image (no cache)..."
	docker build \
		--no-cache \
		--file $(DOCKERFILE_TEST) \
		--tag $(TEST_IMAGE_NAME):latest \
		--network host \
		$(BUILD_CONTEXT)
	@echo "Running tests..."
	docker run --rm $(TEST_IMAGE_NAME):latest

.PHONY: test-image
test-image: build ## Test the production image
	@echo "Testing $(FULL_IMAGE_NAME):$(TAG)..."
	docker run --rm $(FULL_IMAGE_NAME):$(TAG) --version || true

.PHONY: clean
clean: ## Remove local Docker images
	@echo "Removing local images..."
	-docker rmi $(FULL_IMAGE_NAME):$(TAG) 2>/dev/null || true
	-docker rmi $(FULL_IMAGE_NAME):latest 2>/dev/null || true
	-docker rmi $(TEST_IMAGE_NAME):latest 2>/dev/null || true
	@echo "Clean complete"

.PHONY: clean-all
clean-all: ## Remove all related Docker images
	@echo "Removing all related images..."
	-docker images $(FULL_IMAGE_NAME) -q | xargs -r docker rmi -f
	@echo "Clean complete"

.PHONY: inspect
inspect: ## Inspect the Docker image
	@echo "Inspecting $(FULL_IMAGE_NAME):$(TAG)..."
	docker inspect $(FULL_IMAGE_NAME):$(TAG)

.PHONY: version
version: ## Show the current version
	@echo "Version: $(VERSION)"
	@echo "Tag: $(TAG)"
	@echo "Image: $(FULL_IMAGE_NAME):$(TAG)"