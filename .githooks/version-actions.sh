read_metadata_version() {
  jq -er '.["version-name"] | strings' "$metadata_file"
}

read_package_version() {
  jq -er '.version | strings' package.json
}

check_version() {
  local metadata_version package_version normalized_metadata_version
  if ! metadata_version=$(read_metadata_version); then
    echo "ERROR: Unable to read version-name from $metadata_file" >&2; return 2
  fi
  if ! package_version=$(read_package_version); then
    echo "ERROR: Unable to read version from package.json" >&2; return 2
  fi
  if ! normalized_metadata_version=$(normalize_version "$metadata_version"); then
    echo "ERROR: Invalid metadata.json version-name: $metadata_version" >&2; return 2
  fi
  echo "metadata.json version-name: $metadata_version"
  echo "package.json version:       $package_version"
  if [[ "$package_version" != "$normalized_metadata_version" ]]; then
    echo "ERROR: Version mismatch" >&2
    echo "Expected package.json version: $normalized_metadata_version" >&2
    return 1
  fi
  echo "Version check OK."
}

update_version() {
  local metadata_version package_version normalized_metadata_version
  if ! metadata_version=$(read_metadata_version); then
    echo "ERROR: Unable to read version-name from $metadata_file" >&2; return 2
  fi
  if ! package_version=$(read_package_version); then
    echo "ERROR: Unable to read version from package.json" >&2; return 2
  fi
  if ! normalized_metadata_version=$(normalize_version "$metadata_version"); then
    echo "ERROR: Invalid metadata.json version-name: $metadata_version" >&2; return 2
  fi
  echo "metadata.json version-name: $metadata_version"
  if [[ "$package_version" == "$normalized_metadata_version" ]]; then
    echo "package.json version:       $package_version"
    echo "Version already up to date."
    return 0
  fi
  echo "Current package version:    $package_version"
  echo "Updating package version to $normalized_metadata_version ..."
  npm pkg set "version=$normalized_metadata_version" || return
  echo "Updating package-lock.json ..."
  npm install --package-lock-only || return
  echo "Version update complete."
}
