#!/bin/bash

# OpenConnect Installation Helper Script
# Installs OpenConnect via Homebrew (macOS) or apt (Linux/Debian/Ubuntu).

set -e

echo "=========================================="
echo "OpenConnect Installation Helper"
echo "=========================================="
echo ""

case "$OSTYPE" in
  darwin*)
    # Check if Homebrew is installed
    if ! command -v brew &> /dev/null; then
        echo "❌ Homebrew is not installed"
        echo ""
        echo "Please install Homebrew first:"
        echo "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        echo ""
        exit 1
    fi

    echo "✅ Homebrew is installed"
    echo ""

    # Check if OpenConnect is already installed
    if command -v openconnect &> /dev/null; then
        VERSION=$(openconnect --version | head -n1)
        echo "✅ OpenConnect is already installed"
        echo "   $VERSION"
        echo ""
        read -p "Do you want to upgrade to the latest version? (y/N): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "⏳ Upgrading OpenConnect..."
            brew upgrade openconnect
            echo "✅ OpenConnect upgraded successfully!"
        else
            echo "Skipping upgrade"
        fi
    else
        echo "⏳ Installing OpenConnect via Homebrew..."
        echo ""

        brew install openconnect

        if [ $? -eq 0 ]; then
            echo ""
            echo "✅ OpenConnect installed successfully!"
            VERSION=$(openconnect --version | head -n1)
            echo "   $VERSION"
        else
            echo ""
            echo "❌ Failed to install OpenConnect"
            exit 1
        fi
    fi
    ;;

  linux*)
    # Re-run under sudo so apt can install packages.
    if [ "$(id -u)" -ne 0 ]; then
        echo "Administrator privileges are required. Re-running with sudo..."
        echo ""
        exec sudo -E bash "$0" "$@"
    fi

    if ! command -v apt-get &> /dev/null; then
        echo "❌ This script supports Debian/Ubuntu (apt-get) only."
        echo ""
        echo "Please install OpenConnect with your distribution's package manager."
        echo "You will also need the vpnc-scripts and expect packages."
        echo ""
        exit 1
    fi

    echo "⏳ Installing OpenConnect via apt-get..."
    echo ""
    apt-get update
    apt-get install -y openconnect vpnc-scripts expect

    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ OpenConnect installed successfully!"
        VERSION=$(openconnect --version | head -n1)
        echo "   $VERSION"
    else
        echo ""
        echo "❌ Failed to install OpenConnect"
        exit 1
    fi
    ;;

  *)
    echo "❌ This script supports macOS and Linux only"
    exit 1
    ;;
esac

echo ""
echo "=========================================="
echo "Installation complete!"
echo "=========================================="
echo ""
echo "You can now use the OpenConnect VPN GUI application."
echo ""
