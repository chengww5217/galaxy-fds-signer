#!/usr/bin/env bash
#
# Regenerates test/fixtures/golden.json from the official galaxy-fds-sdk-java jar.
#
# Requires a JDK and the FDS jars plus their runtime deps (guava, commons-lang,
# commons-logging) on the classpath. Override LIB_DIR / dependency paths via env
# vars when running outside the original author's machine.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../golden.json"

LIB_DIR="${FDS_LIB_DIR:-/Users/chengww/workspace/weekly-summary/2026/0507/fds/libs}"
GUAVA="${GUAVA_JAR:-$HOME/.m2/repository/com/google/guava/guava/32.0.0-jre/guava-32.0.0-jre.jar}"
COMMONS_LANG="${COMMONS_LANG_JAR:-$HOME/.m2/repository/commons-lang/commons-lang/2.4/commons-lang-2.4.jar}"
COMMONS_LOGGING="${COMMONS_LOGGING_JAR:-$HOME/.m2/repository/commons-logging/commons-logging/1.2/commons-logging-1.2.jar}"

CP="$LIB_DIR/galaxy-fds-core-3.0.48.jar:$LIB_DIR/galaxy-fds-sdk-java-3.0.48.jar:$GUAVA:$COMMONS_LANG:$COMMONS_LOGGING"

javac -cp "$CP" -d "$HERE" "$HERE/GenerateFixtures.java"
java -cp "$CP:$HERE" GenerateFixtures > "$OUT"
echo "Wrote $OUT"
