/*
 * Copyright (c) 2026 MirraNET, Niklas Linz. All rights reserved.
 *
 * This file is part of the MirraNET project and is licensed under the
 * GNU Lesser General Public License v3.0 (LGPLv3).
 *
 * You may use, distribute and modify this code under the terms
 * of the LGPLv3 license. You should have received a copy of the
 * license along with this file. If not, see <https://www.gnu.org/licenses/lgpl-3.0.html>
 * or contact: niklas.linz@mirranet.de
 */

// FreeX Mobile: the Android APK. The iOS app needs a Mac with Xcode (GitHub Actions builds it).
//
// The build agent needs JDK 17 or 21 (Gradle 8.14 does not run on Java 25; FREEX_JDK names the JDK
// if it is not under /usr/lib/jvm), the Android SDK (ANDROID_HOME, platform 35 and build tools; the
// Gradle wrapper fetches everything else). Node.js (apt install nodejs npm) is optional: with it, the
// shared interface is checked first.
// The Android SDK once, as the Jenkins user (the command line tools from developer.android.com):
//
//   mkdir -p ~/android-sdk/cmdline-tools && cd ~/android-sdk/cmdline-tools
//   unzip ~/commandlinetools-linux-*_latest.zip && mv cmdline-tools latest
//   yes | ~/android-sdk/cmdline-tools/latest/bin/sdkmanager --licenses
//   ~/android-sdk/cmdline-tools/latest/bin/sdkmanager "platforms;android-35" "build-tools;35.0.0"
//
// A release keystore for the APK comes from the environment (FREEX_KEYSTORE,
// FREEX_KEYSTORE_PASSWORD, FREEX_KEY_ALIAS, FREEX_KEY_PASSWORD); without it the debug key signs.

pipeline {
    agent any

    options {
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
    }

    stages {
        stage('Interface') {
            steps {
                sh '''
                    # The check of the shared interface needs Node.js (apt install nodejs npm). Without
                    # it the stage is skipped: GitHub Actions runs the same check on every push.
                    if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
                        echo "Node.js not found on this agent: skipping the check of the interface."
                        exit 0
                    fi
                    npm install --no-save --no-audit --no-fund acorn@8
                    node tools/check-web.js
                '''
            }
        }

        stage('Android') {
            steps {
                dir('android') {
                    sh '''
                        # Gradle 8.14 (with the Android plugin 8.7) runs on Java 17 to 24, not on 25:
                        # take FREEX_JDK, otherwise an installed JDK 21 or 17.
                        for j in "${FREEX_JDK:-}" /usr/lib/jvm/java-21-openjdk-amd64 /usr/lib/jvm/temurin-21-jdk-amd64 \\
                                 /usr/lib/jvm/java-17-openjdk-amd64 /usr/lib/jvm/temurin-17-jdk-amd64; do
                            if [ -n "$j" ] && [ -x "$j/bin/java" ]; then export JAVA_HOME="$j"; break; fi
                        done
                        if [ -z "${JAVA_HOME:-}" ] || ! "$JAVA_HOME/bin/java" -version 2>&1 | grep -qE 'version "(17|21)'; then
                            echo "No JDK 17 or 21 found: install one (apt install openjdk-21-jdk-headless) or set FREEX_JDK." >&2
                            exit 1
                        fi
                        "$JAVA_HOME/bin/java" -version
                        # The Android SDK: ANDROID_HOME, otherwise the usual places.
                        if [ -z "${ANDROID_HOME:-}" ]; then
                            for s in "${ANDROID_SDK_ROOT:-}" "$HOME/android-sdk" "$HOME/Android/Sdk" /opt/android-sdk; do
                                if [ -n "$s" ] && [ -d "$s/cmdline-tools" ]; then export ANDROID_HOME="$s"; break; fi
                            done
                        fi
                        if [ -z "${ANDROID_HOME:-}" ]; then
                            echo "No Android SDK found: install it to ~/android-sdk (see Jenkinsfile) or set ANDROID_HOME." >&2
                            exit 1
                        fi
                        echo "ANDROID_HOME=$ANDROID_HOME"
                        ./gradlew --no-daemon assembleRelease
                    '''
                }
                sh '''
                    VERSION=$(sed -n 's/.*"version": *"\\([^"]*\\)".*/\\1/p' web/version.json)
                    mkdir -p dist
                    cp android/app/build/outputs/apk/release/app-release.apk "dist/FreeX-Android-$VERSION.apk"
                '''
            }
        }
    }

    post {
        success {
            archiveArtifacts artifacts: 'dist/*', fingerprint: true
        }
    }
}
