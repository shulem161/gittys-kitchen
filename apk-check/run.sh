#!/bin/bash
# Installs the app, opens it, rings a test timer through the alarm, stops it, and reports what happened as notices.
n(){ echo "::notice title=$1::$(echo "$2" | tr '\n' ' ' | cut -c1-900)"; }
adb install -r apk-check/GittysKitchen.apk; n install "$?"
adb logcat -c
adb shell am start -n com.gittys.kitchen/.MainActivity; sleep 20
n "app running (pid)" "$(adb shell pidof com.gittys.kitchen)"
adb root >/dev/null 2>&1; sleep 5
adb shell am broadcast -n com.gittys.kitchen/.AlarmReceiver -a com.gittys.kitchen.ALARM --es label TestKugel; sleep 5
n "alarm stream playing" "$(adb shell dumpsys audio | grep -iE 'USAGE_ALARM|state:started' | head -6)"
n "notification" "$(adb shell dumpsys notification --noredact | grep -iE 'TestKugel|channel=timers|pkg=com.gittys' | head -6)"
adb shell am broadcast -n com.gittys.kitchen/.AlarmReceiver -a com.gittys.kitchen.STOP; sleep 3
n "after stop" "$(adb shell dumpsys notification --noredact | grep -c TestKugel)"
n "alarm stream after stop" "$(adb shell dumpsys audio | grep -iE 'USAGE_ALARM.*state:started|state:started.*USAGE_ALARM' | head -3)"
n "stop remembered" "$(adb shell run-as com.gittys.kitchen cat shared_prefs/gk.xml 2>&1 | head -3; adb shell su 0 cat /data/data/com.gittys.kitchen/shared_prefs/gk.xml 2>&1 | head -3)"
n "still running after alarm" "$(adb shell pidof com.gittys.kitchen)"
n "errors" "$(adb logcat -d | grep -E 'FATAL|VerifyError|NoSuchMethod|AndroidRuntime|Rejecting|gittys.*(Exception|Error)' | head -15)"
