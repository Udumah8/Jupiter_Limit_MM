#!/bin/bash

# Solana Market Maker Bot Version Management Script
# Provides version information and utilities

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
VERSION_FILE="$PROJECT_ROOT/VERSION"
PACKAGE_JSON="$PROJECT_ROOT/package.json"

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
Solana Market Maker Bot Version Management Script

USAGE:
    $0 [COMMAND] [OPTIONS]

COMMANDS:
    show         Show current version information (default)
    check        Check version consistency across files
    validate     Validate version format
    bump-patch   Bump patch version (1.0.0 -> 1.0.1)
    bump-minor   Bump minor version (1.0.0 -> 1.1.0)
    bump-major   Bump major version (1.0.0 -> 2.0.0)
    set <ver>    Set version to specific value

OPTIONS:
    -q, --quiet  Suppress informational output
    -h, --help   Show this help message

EXAMPLES:
    $0                    # Show current version
    $0 check             # Check version consistency
    $0 bump-patch        # Increment patch version
    $0 set 1.2.3         # Set specific version

EOF
}

get_version_from_file() {
    if [ -f "$VERSION_FILE" ]; then
        cat "$VERSION_FILE" | tr -d '\n'
    else
        echo ""
    fi
}

get_version_from_package_json() {
    if [ -f "$PACKAGE_JSON" ]; then
        grep '"version"' "$PACKAGE_JSON" | sed 's/.*"version": "\([^"]*\)".*/\1/'
    else
        echo ""
    fi
}

validate_version_format() {
    local version="$1"
    if [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        return 0
    else
        return 1
    fi
}

increment_version() {
    local current="$1"
    local type="$2"

    IFS='.' read -ra VERSION_PARTS <<< "$current"
    local major="${VERSION_PARTS[0]}"
    local minor="${VERSION_PARTS[1]}"
    local patch="${VERSION_PARTS[2]}"

    case $type in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch)
            patch=$((patch + 1))
            ;;
        *)
            log_error "Invalid increment type: $type"
            exit 1
            ;;
    esac

    echo "$major.$minor.$patch"
}

update_version_file() {
    local new_version="$1"
    echo "$new_version" > "$VERSION_FILE"
    if [ "$QUIET" != true ]; then
        log_info "Updated VERSION file to: $new_version"
    fi
}

update_package_json() {
    local new_version="$1"
    if [ -f "$PACKAGE_JSON" ]; then
        # Create backup
        cp "$PACKAGE_JSON" "$PACKAGE_JSON.bak"

        # Update version in package.json
        sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$new_version\"/" "$PACKAGE_JSON"
        rm -f "$PACKAGE_JSON.bak"

        if [ "$QUIET" != true ]; then
            log_info "Updated package.json version to: $new_version"
        fi
    fi
}

show_version_info() {
    local version_file=$(get_version_from_file)
    local version_package=$(get_version_from_package_json)

    echo "Solana Market Maker Bot Version Information"
    echo "=========================================="
    echo
    echo "VERSION file:     $version_file"
    echo "package.json:     $version_package"

    if [ -n "$version_file" ] && [ -n "$version_package" ]; then
        if [ "$version_file" = "$version_package" ]; then
            echo -e "Status:           ${GREEN}✓ Consistent${NC}"
        else
            echo -e "Status:           ${RED}✗ Inconsistent${NC}"
        fi
    fi

    echo
    echo "Git Information:"
    if command -v git &> /dev/null && [ -d "$PROJECT_ROOT/.git" ]; then
        local git_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "No tags found")
        local git_commit=$(git rev-parse --short HEAD 2>/dev/null || echo "Unknown")
        local git_branch=$(git branch --show-current 2>/dev/null || echo "Unknown")

        echo "Latest Tag:       $git_tag"
        echo "Current Commit:   $git_commit"
        echo "Current Branch:   $git_branch"

        if [ -n "$version_file" ] && [ "$git_tag" = "v$version_file" ]; then
            echo -e "Tag Status:       ${GREEN}✓ Matches VERSION file${NC}"
        elif [ "$git_tag" != "No tags found" ]; then
            echo -e "Tag Status:       ${YELLOW}⚠ Mismatch with VERSION file${NC}"
        fi
    else
        echo "Git repository not found or git not available"
    fi

    echo
    echo "Build Information:"
    echo "Build Date:       $(date)"
    echo "Node Version:     $(node --version 2>/dev/null || echo 'Not available')"
    echo "NPM Version:      $(npm --version 2>/dev/null || echo 'Not available')"
}

check_version_consistency() {
    local version_file=$(get_version_from_file)
    local version_package=$(get_version_from_package_json)
    local errors=0

    if [ -z "$version_file" ]; then
        log_error "VERSION file not found or empty"
        errors=$((errors + 1))
    else
        if ! validate_version_format "$version_file"; then
            log_error "VERSION file contains invalid version format: $version_file"
            errors=$((errors + 1))
        fi
    fi

    if [ -f "$PACKAGE_JSON" ]; then
        if [ -z "$version_package" ]; then
            log_error "Version not found in package.json"
            errors=$((errors + 1))
        else
            if ! validate_version_format "$version_package"; then
                log_error "package.json contains invalid version format: $version_package"
                errors=$((errors + 1))
            fi
        fi
    fi

    if [ -n "$version_file" ] && [ -n "$version_package" ] && [ "$version_file" != "$version_package" ]; then
        log_error "Version mismatch: VERSION file ($version_file) != package.json ($version_package)"
        errors=$((errors + 1))
    fi

    if [ $errors -eq 0 ]; then
        if [ "$QUIET" != true ]; then
            log_success "Version consistency check passed"
        fi
        return 0
    else
        if [ "$QUIET" != true ]; then
            log_error "Version consistency check failed with $errors error(s)"
        fi
        return 1
    fi
}

bump_version() {
    local type="$1"
    local current_version=$(get_version_from_file)

    if [ -z "$current_version" ]; then
        log_error "Cannot bump version: VERSION file not found or empty"
        exit 1
    fi

    local new_version=$(increment_version "$current_version" "$type")

    if [ "$QUIET" != true ]; then
        log_info "Bumping $type version: $current_version -> $new_version"
    fi

    update_version_file "$new_version"
    update_package_json "$new_version"

    if [ "$QUIET" != true ]; then
        log_success "Version bumped to: $new_version"
    fi

    echo "$new_version"
}

set_version() {
    local new_version="$1"

    if ! validate_version_format "$new_version"; then
        log_error "Invalid version format: $new_version"
        log_info "Expected format: MAJOR.MINOR.PATCH (e.g., 1.2.3)"
        exit 1
    fi

    if [ "$QUIET" != true ]; then
        log_info "Setting version to: $new_version"
    fi

    update_version_file "$new_version"
    update_package_json "$new_version"

    if [ "$QUIET" != true ]; then
        log_success "Version set to: $new_version"
    fi

    echo "$new_version"
}

# Parse command line arguments
QUIET=false
COMMAND="show"

while [[ $# -gt 0 ]]; do
    case $1 in
        -q|--quiet)
            QUIET=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        show|check|validate|bump-patch|bump-minor|bump-major)
            COMMAND="$1"
            shift
            ;;
        set)
            COMMAND="$1"
            shift
            if [ $# -eq 0 ]; then
                log_error "set command requires a version argument"
                exit 1
            fi
            VERSION_ARG="$1"
            shift
            ;;
        *)
            log_error "Unknown command: $1"
            show_help
            exit 1
            ;;
    esac
done

# Execute command
case $COMMAND in
    show)
        show_version_info
        ;;
    check)
        check_version_consistency
        ;;
    validate)
        if [ $# -eq 0 ]; then
            log_error "validate command requires a version argument"
            exit 1
        fi
        if validate_version_format "$1"; then
            if [ "$QUIET" != true ]; then
                log_success "Valid version format: $1"
            fi
            exit 0
        else
            if [ "$QUIET" != true ]; then
                log_error "Invalid version format: $1"
            fi
            exit 1
        fi
        ;;
    bump-patch|bump-minor|bump-major)
        type="${COMMAND#bump-}"
        bump_version "$type"
        ;;
    set)
        if [ -z "$VERSION_ARG" ]; then
            log_error "set command requires a version argument"
            exit 1
        fi
        set_version "$VERSION_ARG"
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        show_help
        exit 1
        ;;
esac
