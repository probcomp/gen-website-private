#!/bin/bash

# Check if a domain name argument is provided
if [ -z "$1" ]; then
  echo "Usage: $0 <DOMAIN_NAME>"
  exit 1
fi

# Set the domain name from the command-line argument
DOMAIN_NAME="$1"

# Check if the domain mapping already exists
EXISTING_MAPPING=$(gcloud app domain-mappings list --format="value(id)" --filter="id:$DOMAIN_NAME")

if [ -z "$EXISTING_MAPPING" ]; then
  echo "Domain mapping for $DOMAIN_NAME does not exist. Creating domain mapping..."
  
  # Create the domain mapping with automatic certificate management
  gcloud app domain-mappings create $DOMAIN_NAME --certificate-management=AUTOMATIC
  
  if [ $? -eq 0 ]; then
    echo "Domain mapping for $DOMAIN_NAME created successfully."
  else
    echo "Failed to create domain mapping for $DOMAIN_NAME."
  fi
else
  echo "Domain mapping for $DOMAIN_NAME already exists. No action taken."
fi