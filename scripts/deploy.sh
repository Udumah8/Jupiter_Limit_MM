#!/bin/bash

# Solana Market Maker Bot Deployment Script
# This script handles deployment for different environments

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
ENV_FILE="$PROJECT_ROOT/.env"

# Default values
ENVIRONMENT="production"
DOCKER_COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
BACKUP_DIR="$PROJECT_ROOT/backups/$(date +%Y%m%d_%H%M%S)"

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
Solana Market Maker Bot Deployment Script

USAGE:
    $0 [OPTIONS] [COMMAND]

COMMANDS:
    deploy      Deploy the bot (default)
    stop        Stop the running bot
    restart     Restart the bot
    status      Show bot status
    logs        Show bot logs
    backup      Create backup of wallets and state
    restore     Restore from backup
    cleanup     Clean up old containers and images

OPTIONS:
    -e, --env ENVIRONMENT    Target environment (production, staging, development)
    -f, --file FILE          Docker Compose file path
    -b, --backup-dir DIR     Backup directory
    -h, --help              Show this help message

EXAMPLES:
    $0 deploy                    # Deploy to production
    $0 -e staging deploy         # Deploy to staging
    $0 stop                      # Stop the bot
    $0 logs -f                   # Follow logs
    $0 backup                    # Create backup
    $0 -b ./mybackup restore     # Restore from specific backup

ENVIRONMENTS:
    production  - Live trading environment
    staging     - Test environment with real Solana devnet
    development - Local development environment

EOF
}

check_dependencies() {
    log_info "Checking dependencies..."

    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi

    # Check if Docker Compose is available
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi

    # Check if .env file exists
    if [ ! -f "$ENV_FILE" ]; then
        log_error ".env file not found. Please copy .env.example to .env and configure it."
        exit 1
    fi

    log_success "Dependencies check passed"
}

create_backup() {
    log_info "Creating backup..."

    mkdir -p "$BACKUP_DIR"

    # Backup wallets
    if [ -f "$PROJECT_ROOT/wallets.json" ]; then
        cp "$PROJECT_ROOT/wallets.json" "$BACKUP_DIR/"
        log_info "Wallets backed up"
    fi

    # Backup state
    if [ -f "$PROJECT_ROOT/state.json" ]; then
        cp "$PROJECT_ROOT/state.json" "$BACKUP_DIR/"
        log_info "State backed up"
    fi

    # Backup logs
    if [ -d "$PROJECT_ROOT/logs" ]; then
        cp -r "$PROJECT_ROOT/logs" "$BACKUP_DIR/"
        log_info "Logs backed up"
    fi

    # Backup configuration (without sensitive data)
    cp "$PROJECT_ROOT/.env" "$BACKUP_DIR/.env.backup"

    log_success "Backup created at: $BACKUP_DIR"
}

restore_backup() {
    if [ -z "$BACKUP_DIR" ] || [ ! -d "$BACKUP_DIR" ]; then
        log_error "Backup directory not found: $BACKUP_DIR"
        exit 1
    fi

    log_info "Restoring from backup: $BACKUP_DIR"

    # Stop bot before restore
    log_info "Stopping bot for safe restore..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" down || true

    # Restore files
    if [ -f "$BACKUP_DIR/wallets.json" ]; then
        cp "$BACKUP_DIR/wallets.json" "$PROJECT_ROOT/"
        log_info "Wallets restored"
    fi

    if [ -f "$BACKUP_DIR/state.json" ]; then
        cp "$BACKUP_DIR/state.json" "$PROJECT_ROOT/"
        log_info "State restored"
    fi

    if [ -d "$BACKUP_DIR/logs" ]; then
        cp -r "$BACKUP_DIR/logs" "$PROJECT_ROOT/"
        log_info "Logs restored"
    fi

    log_success "Backup restored successfully"
}

deploy_bot() {
    log_info "Deploying Solana Market Maker Bot to $ENVIRONMENT environment..."

    # Create backup before deployment
    create_backup

    # Build and start containers
    log_info "Building Docker image..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" build --no-cache

    log_info "Starting services..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" up -d

    # Wait for health check
    log_info "Waiting for bot to be healthy..."
    sleep 10

    # Check status
    if docker-compose -f "$DOCKER_COMPOSE_FILE" ps | grep -q "Up"; then
        log_success "Bot deployed successfully!"

        # Show status
        echo ""
        log_info "Bot Status:"
        docker-compose -f "$DOCKER_COMPOSE_FILE" ps

        echo ""
        log_info "To view logs: $0 logs"
        log_info "To check status: $0 status"
        log_info "To stop bot: $0 stop"
    else
        log_error "Bot deployment failed. Check logs:"
        docker-compose -f "$DOCKER_COMPOSE_FILE" logs
        exit 1
    fi
}

stop_bot() {
    log_info "Stopping Solana Market Maker Bot..."

    # Create backup before stopping
    create_backup

    docker-compose -f "$DOCKER_COMPOSE_FILE" down

    log_success "Bot stopped successfully"
}

restart_bot() {
    log_info "Restarting Solana Market Maker Bot..."

    docker-compose -f "$DOCKER_COMPOSE_FILE" restart

    log_success "Bot restarted successfully"
}

show_status() {
    log_info "Bot Status:"

    docker-compose -f "$DOCKER_COMPOSE_FILE" ps

    echo ""
    log_info "Container Health:"
    docker-compose -f "$DOCKER_COMPOSE_FILE" exec climarket-bot node src/index.js status 2>/dev/null || echo "Bot not responding"
}

show_logs() {
    if [ "$1" = "-f" ] || [ "$1" = "--follow" ]; then
        log_info "Following bot logs (Ctrl+C to stop)..."
        docker-compose -f "$DOCKER_COMPOSE_FILE" logs -f climarket-bot
    else
        log_info "Bot logs:"
        docker-compose -f "$DOCKER_COMPOSE_FILE" logs climarket-bot
    fi
}

cleanup() {
    log_info "Cleaning up old containers and images..."

    # Remove stopped containers
    docker container prune -f

    # Remove unused images
    docker image prune -f

    # Remove unused volumes
    docker volume prune -f

    log_success "Cleanup completed"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -f|--file)
            DOCKER_COMPOSE_FILE="$2"
            shift 2
            ;;
        -b|--backup-dir)
            BACKUP_DIR="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        deploy|stop|restart|status|logs|backup|restore|cleanup)
            COMMAND="$1"
            shift
            break
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Default command
COMMAND="${COMMAND:-deploy}"

# Validate environment
case $ENVIRONMENT in
    production|staging|development)
        ;;
    *)
        log_error "Invalid environment: $ENVIRONMENT"
        log_info "Valid environments: production, staging, development"
        exit 1
        ;;
esac

# Set environment-specific variables
case $ENVIRONMENT in
    production)
        export NODE_ENV=production
        export LOG_LEVEL=info
        ;;
    staging)
        export NODE_ENV=staging
        export LOG_LEVEL=debug
        ;;
    development)
        export NODE_ENV=development
        export LOG_LEVEL=debug
        ;;
esac

# Execute command
case $COMMAND in
    deploy)
        check_dependencies
        deploy_bot
        ;;
    stop)
        stop_bot
        ;;
    restart)
        restart_bot
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$@"
        ;;
    backup)
        create_backup
        ;;
    restore)
        restore_backup
        ;;
    cleanup)
        cleanup
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        show_help
        exit 1
        ;;
esac
