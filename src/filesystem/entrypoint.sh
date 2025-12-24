#!/bin/sh
set -e

# Default plocate database location
PLOCATE_DB="${PLOCATE_DB:-/var/lib/plocate/plocate.db}"
PLOCATE_DB_DIR=$(dirname "$PLOCATE_DB")

# Ensure the database directory exists
mkdir -p "$PLOCATE_DB_DIR"

# Get allowed directories from command line arguments
# The arguments are passed directly to this script and will be forwarded to Node.js
# We'll use all arguments as potential directory paths for indexing
ALLOWED_DIRS=""

# Collect non-empty arguments
for arg in "$@"; do
  if [ -n "$arg" ]; then
    if [ -z "$ALLOWED_DIRS" ]; then
      ALLOWED_DIRS="$arg"
    else
      ALLOWED_DIRS="$ALLOWED_DIRS $arg"
    fi
  fi
done

# If no directories provided, check environment variable
if [ -z "$ALLOWED_DIRS" ] && [ -n "$ALLOWED_DIRECTORIES" ]; then
  ALLOWED_DIRS="$ALLOWED_DIRECTORIES"
fi

# Index the allowed directories if any are provided
if [ -n "$ALLOWED_DIRS" ]; then
  echo "Indexing allowed directories with plocate..." >&2
  
  # Collect valid directories
  VALID_DIRS=""
  for dir in $ALLOWED_DIRS; do
    # Expand ~ if present
    expanded_dir=$(echo "$dir" | sed "s|^~|$HOME|")
    
    if [ -d "$expanded_dir" ]; then
      echo "  Adding directory to index: $expanded_dir" >&2
      if [ -z "$VALID_DIRS" ]; then
        VALID_DIRS="$expanded_dir"
      else
        VALID_DIRS="$VALID_DIRS $expanded_dir"
      fi
    else
      echo "  Warning: Directory does not exist: $expanded_dir" >&2
    fi
  done
  
  # Use updatedb to create the database with --localpaths to index only specified directories
  if [ -n "$VALID_DIRS" ]; then
    # Build the localpaths argument - space-separated list
    # Note: updatedb --localpaths expects a space-separated list
    updatedb --output "$PLOCATE_DB" --localpaths "$VALID_DIRS" 2>&1 || {
      echo "Warning: plocate database update failed, continuing anyway..." >&2
      echo "This may be due to permissions or plocate configuration." >&2
      echo "The server will continue but search_files may fall back to slower method." >&2
    }
    
    if [ ! -f "$PLOCATE_DB" ]; then
      echo "Warning: plocate database was not created. Search may be slower." >&2
    else
      echo "Plocate database created successfully at $PLOCATE_DB" >&2
      # Show database size
      db_size=$(du -h "$PLOCATE_DB" | cut -f1)
      echo "Database size: $db_size" >&2
    fi
  fi
else
  echo "No allowed directories provided for indexing. Plocate will not be used." >&2
  echo "Directories may be provided later via MCP roots protocol." >&2
fi

# Export the database path for the Node.js process
export PLOCATE_DB

# Start the Node.js server with the original arguments
exec node /app/dist/index.js "$@"

