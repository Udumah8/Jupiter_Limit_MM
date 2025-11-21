#!/bin/bash

# Solana Market Maker Bot Setup Script
# This script helps with initial project setup and configuration

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_help() {
    cat << EOF
Solana Market Maker Bot Setup Script

USAGE:
    $0 [OPTIONS] [COMMAND]

COMMANDS:
    all         Run complete setup (default)
    dependencies Install system dependencies
    project     Set up project structure
    config      Set up configuration files
    test        Run tests to verify setup
    docker      Set up Docker environment

OPTIONS:
    -y, --yes   Answer yes to all prompts
    -h, --help  Show this help message

EXAMPLES:
    $0              # Run complete setup
    $0 dependencies # Install only dependencies
    $0 config       # Set up only configuration
    $0 -y all       # Run setup without prompts

EOF
}

check_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
        OS="windows"
    else
        OS="unknown"
    fi

    log_info "Detected OS: $OS"
}

install_dependencies() {
    log_info "Installing system dependencies..."

    case $OS in
        linux)
            # Check if running on Ubuntu/Debian
            if command -v apt-get &> /dev/null; then
                log_info "Installing dependencies with apt-get..."
                sudo apt-get update
                sudo apt-get install -y curl wget git build-essential python3 python3-pip
            elif command -v yum &> /dev/null; then
                log_info "Installing dependencies with yum..."
                sudo yum update -y
                sudo yum install -y curl wget git gcc gcc-c++ python3 python3-pip
            else
                log_warning "Unknown Linux distribution. Please install dependencies manually."
            fi
            ;;
        macos)
            if command -v brew &> /dev/null; then
                log_info "Installing dependencies with Homebrew..."
                brew install curl wget git python3
            else
                log_warning "Homebrew not found. Please install Homebrew first or install dependencies manually."
            fi
            ;;
        windows)
            log_warning "Please ensure the following are installed on Windows:"
            echo "  - Git: https://git-scm.com/downloads"
            echo "  - Node.js: https://nodejs.org/"
            echo "  - Python 3: https://www.python.org/downloads/"
            echo "  - Docker Desktop: https://www.docker.com/products/docker-desktop"
            ;;
        *)
            log_warning "Unknown OS. Please install dependencies manually."
            ;;
    esac

    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed. Please install Node.js 18+ first."
        exit 1
    fi

    # Check Node.js version
    NODE_VERSION=$(node --version | sed 's/v//')
    if ! [ "$(printf '%s\n' "$NODE_VERSION" "18.0.0" | sort -V | head -n1)" = "18.0.0" ]; then
        log_error "Node.js version 18+ is required. Current version: $NODE_VERSION"
        exit 1
    fi

    # Check if npm is installed
    if ! command -v npm &> /dev/null; then
        log_error "npm is not installed. Please install npm."
        exit 1
    fi

    log_success "System dependencies check passed"
}

setup_project() {
    log_info "Setting up project structure..."

    cd "$PROJECT_ROOT"

    # Install Node.js dependencies
    if [ -f "package.json" ]; then
        log_info "Installing Node.js dependencies..."
        npm install
    else
        log_error "package.json not found. Please run this script from the project root."
        exit 1
    fi

    # Create necessary directories
    log_info "Creating project directories..."
    mkdir -p logs config backups

    # Set up git hooks (if git is available)
    if command -v git &> /dev/null && [ -d ".git" ]; then
        log_info "Setting up git hooks..."
        # Add any git hooks here if needed
    fi

    log_success "Project structure setup completed"
}

setup_config() {
    log_info "Setting up configuration..."

    cd "$PROJECT_ROOT"

    # Check if .env already exists
    if [ -f ".env" ]; then
        if [ "$ASSUME_YES" = true ]; then
            log_warning ".env file already exists. Skipping configuration setup."
            return
        else
            read -p ".env file already exists. Overwrite? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_info "Skipping configuration setup."
                return
            fi
        fi
    fi

    # Copy .env.example to .env
    if [ -f ".env.example" ]; then
        cp .env.example .env
        log_info "Created .env file from .env.example"
    else
        log_error ".env.example not found."
        exit 1
    fi

    log_warning "IMPORTANT: Please edit the .env file with your actual configuration values."
    log_warning "Required settings:"
    echo "  - FUNDING_WALLET_PRIVATE_KEY: Your Solana wallet private key"
    echo "  - WALLET_ENCRYPTION_KEY: 32-character encryption key"
    echo "  - SOLANA_RPC_URL: Solana RPC endpoint"
    echo "  - DEX_NAME: DEX to use (raydium, orca, etc.)"
    echo "  - BASE_MINT and QUOTE_MINT: Token addresses"

    if [ "$ASSUME_YES" != true ]; then
        echo
        read -p "Press Enter after you've configured the .env file..."
    fi

    log_success "Configuration setup completed"
}

run_tests() {
    log_info "Running tests to verify setup..."

    cd "$PROJECT_ROOT"

    # Run npm test if available
    if [ -f "package.json" ] && grep -q '"test"' package.json; then
        log_info "Running npm tests..."
        npm test
    else
        log_warning "No test script found in package.json. Running basic syntax check..."

        # Basic syntax check for JavaScript files
        find src -name "*.js" -exec node -c {} \;
        log_success "Syntax check passed"
    fi
}

setup_docker() {
    log_info "Setting up Docker environment..."

    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        log_info "Download from: https://www.docker.com/products/docker-desktop"
        exit 1
    fi

    # Check if Docker Compose is available
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not available. Please install Docker Compose."
        exit 1
    fi

    # Build Docker image to verify setup
    log_info "Building Docker image..."
    docker-compose build

    log_success "Docker environment setup completed"
}

run_complete_setup() {
    log_info "Running complete setup..."

    check_os
    install_dependencies
    setup_project
    setup_config
    run_tests
    setup_docker

    log_success "Complete setup finished!"
    echo
    log_info "Next steps:"
    echo "  1. Edit the .env file with your configuration"
    echo "  2. Test the bot: npm run status"
    echo "  3. Start the bot: npm start"
    echo "  4. Or deploy with Docker: ./scripts/deploy.sh deploy"
    echo
    log_info "For more information, see README.md"
}

# Parse command line arguments
ASSUME_YES=false
COMMAND="all"

while [[ $# -gt 0 ]]; do
    case $1 in
        -y|--yes)
            ASSUME_YES=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        dependencies|project|config|test|docker|all)
            COMMAND="$1"
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Execute command
case $COMMAND in
    dependencies)
        check_os
        install_dependencies
        ;;
    project)
        setup_project
        ;;
    config)
        setup_config
        ;;
    test)
        run_tests
        ;;
    docker)
        setup_docker
        ;;
    all)
        run_complete_setup
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        show_help
        exit 1
        ;;
esac
