#!/bin/bash
# ============================================
# Reader - Linux Build Script
# Builds the Tauri desktop application
# ============================================

set -e  # Exit on error

echo ""
echo "========================================"
echo "  Reader - Linux Build Script"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERROR] Node.js is not installed${NC}"
    echo "Please install Node.js:"
    echo "  Ubuntu/Debian: sudo apt install nodejs npm"
    echo "  Arch Linux:    sudo pacman -S nodejs npm"
    echo "  Or use nvm:    https://github.com/nvm-sh/nvm"
    exit 1
fi

# Check for Rust
if ! command -v rustc &> /dev/null; then
    echo -e "${RED}[ERROR] Rust is not installed${NC}"
    echo "Please install Rust from https://rustup.rs/"
    echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# Check for required system libraries (Tauri dependencies)
echo -e "${YELLOW}[INFO] Checking system dependencies...${NC}"

MISSING_DEPS=""

# Check for webkit2gtk (required for Tauri on Linux)
if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null && ! pkg-config --exists webkit2gtk-4.0 2>/dev/null; then
    MISSING_DEPS="$MISSING_DEPS webkit2gtk"
fi

# Check for GTK3
if ! pkg-config --exists gtk+-3.0 2>/dev/null; then
    MISSING_DEPS="$MISSING_DEPS gtk3"
fi

# Check for libappindicator or libayatana-appindicator
if ! pkg-config --exists appindicator3-0.1 2>/dev/null && ! pkg-config --exists ayatana-appindicator3-0.1 2>/dev/null; then
    MISSING_DEPS="$MISSING_DEPS libappindicator"
fi

if [ -n "$MISSING_DEPS" ]; then
    echo -e "${RED}[ERROR] Missing system dependencies:$MISSING_DEPS${NC}"
    echo ""
    echo "Install them with:"
    echo "  Ubuntu/Debian:"
    echo "    sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libappindicator3-dev librsvg2-dev"
    echo ""
    echo "  Fedora:"
    echo "    sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel"
    echo ""
    echo "  Arch Linux:"
    echo "    sudo pacman -S webkit2gtk-4.1 gtk3 libappindicator-gtk3 librsvg"
    echo ""
    exit 1
fi

echo -e "${GREEN}[OK] System dependencies found${NC}"
echo ""

# Display versions
echo -e "${YELLOW}[INFO] Node.js version:${NC} $(node --version)"
echo -e "${YELLOW}[INFO] npm version:${NC} $(npm --version)"
echo -e "${YELLOW}[INFO] Rust version:${NC} $(rustc --version)"
echo -e "${YELLOW}[INFO] Cargo version:${NC} $(cargo --version)"
echo ""

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}[INFO] Installing npm dependencies...${NC}"
    npm install
else
    echo -e "${YELLOW}[INFO] node_modules exists, skipping npm install${NC}"
    echo "[INFO] Run 'npm install' manually if you need to update dependencies"
fi
echo ""

# Build the application
echo -e "${YELLOW}[INFO] Building Tauri application for Linux...${NC}"
echo "[INFO] This may take several minutes on first build..."
echo ""

npm run tauri:build

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Build completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Output files can be found in:"
echo "  src-tauri/target/release/"
echo ""
echo "Package files:"
echo "  src-tauri/target/release/bundle/deb/   (Debian package)"
echo "  src-tauri/target/release/bundle/appimage/  (AppImage)"
echo "  src-tauri/target/release/bundle/rpm/   (RPM package, if available)"
echo ""
