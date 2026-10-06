#!/bin/sh
# voice-gen design|synth|page [--archetypes uncle,driver] [--dry-run]  (builds the jar on first use; needs JDK 21+)
set -e
here="$(cd "$(dirname "$0")" && pwd)"
if [ -x /usr/libexec/java_home ] && J=$(/usr/libexec/java_home -v 21+ 2>/dev/null); then export JAVA_HOME="$J"; fi
jar="$here/target/voice-gen.jar"
if [ ! -f "$jar" ] || [ -n "$(find "$here/src" "$here/pom.xml" -newer "$jar" 2>/dev/null | head -1)" ]; then
  (cd "$here" && mvn -q -DskipTests package)
fi
exec "${JAVA_HOME:+$JAVA_HOME/bin/}java" -jar "$jar" "$@"
