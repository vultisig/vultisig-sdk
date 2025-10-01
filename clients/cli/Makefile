# Vultisig CLI Makefile

.PHONY: build install uninstall clean test help

# Default target
help:
	@echo "🔧 Vultisig CLI Build Commands"
	@echo ""
	@echo "Available commands:"
	@echo "  make build     - Build standalone binary"
	@echo "  make install   - Add Vultisig CLI to your shell PATH"
	@echo "  make uninstall - Remove from system PATH"
	@echo "  make clean     - Clean build artifacts"
	@echo "  make test      - Test the built binary"
	@echo "  make help      - Show this help"
	@echo ""
	@echo "💡 Quick start:"
	@echo "  make build && make install"

# Build standalone binary
build:
	@echo "🏗️  Building Vultisig CLI binary..."
	./scripts/build-final.sh

# Install to system PATH
install:
	@echo "🚀 Installing Vultisig CLI..."
	./scripts/install.sh

# Uninstall from system PATH
uninstall:
	@echo "🗑️  Uninstalling Vultisig CLI..."
	./scripts/uninstall.sh

# Clean build artifacts
clean:
	@echo "🧹 Cleaning build artifacts..."
	rm -rf dist bin

# Test the binary
test: build
	@echo "🧪 Testing binary..."
	@if [ -f bin/vultisig ]; then \
		echo "✅ Binary exists"; \
		./bin/vultisig --version; \
		./bin/vultisig --help | head -5; \
	else \
		echo "❌ Binary not found"; \
		exit 1; \
	fi