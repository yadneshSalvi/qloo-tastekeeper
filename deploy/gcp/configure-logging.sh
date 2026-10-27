#!/usr/bin/env bash
set -euo pipefail
# Apply before public traffic. Preserve every unrelated sink and exclusion.
gc=${TASTEKEEPER_GCLOUD_WRAPPER:-./deploy/gcp/gcloud.sh}
name=tastekeeper-private-capability-requests
filter=$(cat ./deploy/gcp/capability-request-exclusion.filter)
existing=$("$gc" logging sinks describe _Default --format=json)
if python3 -c 'import json,sys; x=json.load(sys.stdin); sys.exit(not any(e.get("name")==sys.argv[1] for e in x.get("exclusions",[])))' "$name" <<<"$existing"; then mode=--update-exclusion; else mode=--add-exclusion; fi
"$gc" logging sinks update _Default "$mode=name=$name,filter=$filter,description=Omit private gateway and client request URLs" --quiet
final=$("$gc" logging sinks describe _Default --format=json)
python3 -c 'import json,sys; x=json.load(sys.stdin); e=next((e for e in x.get("exclusions",[]) if e.get("name")==sys.argv[1]),None); assert e and not e.get("disabled",False) and e.get("filter")==sys.argv[2], "Private request exclusion is not active"; print(json.dumps({"sink":x["name"],"enabledCapabilityExclusion":e["name"]}))' "$name" "$filter" <<<"$final"
