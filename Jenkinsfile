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

// FreeX Mobile: the Android APK on a Linux agent and the iOS app on a Mac agent, side by side.
//
// Agents: the Linux stages run on any agent except the Mac (label FREEX_LINUX_AGENT, default
// "!Spark"), the iOS stage on the Mac (label FREEX_IOS_AGENT, default "Spark"). Both can be set as
// global environment variables in Jenkins; without a Mac agent the iOS stage waits for one, so set
// FREEX_IOS=off there to leave it out.
//
// Android: JDK 17 or 21 (Gradle 8.14 does not run on Java 25; FREEX_JDK names the JDK if it is not
// under /usr/lib/jvm) and the Android SDK (ANDROID_HOME, platform 35 and build tools; the Gradle
// wrapper fetches everything else). Node.js (apt install nodejs npm) is optional: with it, the
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
//
// iOS: Xcode 14 or newer on the Mac (on Intel Macs Xcode 26 is the last one), set up once:
//
//   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
//   sudo xcodebuild -license accept && xcodebuild -runFirstLaunch
//   xcodebuild -downloadPlatform iOS      # Xcode 15 and newer, if the iOS platform is missing
//
// Without xcode-select the stage takes the newest /Applications/Xcode*.app (or FREEX_XCODE).
//
// Without more, the stage builds the app unsigned (FreeX-iOS-<version>-unsigned.ipa, for signing
// with Sideloadly or AltStore). With FREEX_IOS_TEAM (the team ID of an Apple developer account that
// is signed in in Xcode on the Mac) it also signs a development IPA (FreeX-iOS-<version>.ipa) for
// the devices registered in that account.

pipeline {
    agent none

    options {
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
    }

    stages {
        stage('Interface') {
            agent { label "${env.FREEX_LINUX_AGENT ?: '!Spark'}" }
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

        stage('Apps') {
            failFast false
            parallel {
                stage('Android') {
                    agent { label "${env.FREEX_LINUX_AGENT ?: '!Spark'}" }
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
                    post {
                        success {
                            archiveArtifacts artifacts: 'dist/*', fingerprint: true
                        }
                    }
                }

                stage('iOS') {
                    when { expression { env.FREEX_IOS != 'off' } }
                    agent { label "${env.FREEX_IOS_AGENT ?: 'Spark'}" }
                    steps {
                        sh '''
                            set -e
                            # Xcode itself, not the Command Line Tools: FREEX_XCODE, the one chosen with
                            # xcode-select, otherwise the newest Xcode*.app in /Applications.
                            if [ -n "${FREEX_XCODE:-}" ]; then
                                export DEVELOPER_DIR="$FREEX_XCODE/Contents/Developer"
                            elif ! xcode-select -p 2>/dev/null | grep -q '\\.app/'; then
                                X=$(ls -d /Applications/Xcode*.app 2>/dev/null | sort -V | tail -1)
                                if [ -z "$X" ]; then
                                    echo "No Xcode found on this Mac: install Xcode 26 (see the Jenkinsfile) into /Applications." >&2
                                    exit 1
                                fi
                                export DEVELOPER_DIR="$X/Contents/Developer"
                            fi
                            echo "DEVELOPER_DIR=${DEVELOPER_DIR:-$(xcode-select -p)}"
                            xcodebuild -version
                            VERSION=$(sed -n 's/.*"version": *"\\([^"]*\\)".*/\\1/p' web/version.json)
                            DD="$WORKSPACE/build/ios"
                            rm -rf build dist
                            mkdir -p build dist

                            # unsigned: for Sideloadly / AltStore
                            xcodebuild -project ios/FreeX.xcodeproj -scheme FreeX -configuration Release -sdk iphoneos \\
                                -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \\
                                build | tee "$WORKSPACE/build/xcodebuild.log" | grep -E 'error:|warning: .*/ios/FreeX/|BUILD' || true
                            grep -q 'BUILD SUCCEEDED' "$WORKSPACE/build/xcodebuild.log" || { grep -B2 -A4 'error:' "$WORKSPACE/build/xcodebuild.log" | head -60; exit 1; }
                            APP="$DD/Build/Products/Release-iphoneos/FreeX.app"
                            test -f "$APP/web/index.html"
                            rm -rf build/Payload && mkdir -p build/Payload && cp -R "$APP" build/Payload/
                            (cd build && zip -qry "../dist/FreeX-iOS-$VERSION-unsigned.ipa" Payload)

                            # signed for development, when a team is given
                            if [ -n "${FREEX_IOS_TEAM:-}" ]; then
                                # export options: development signing for the team, profiles managed by Xcode
                                /usr/libexec/PlistBuddy -c 'Add :method string development' -c "Add :teamID string $FREEX_IOS_TEAM" \\
                                    -c 'Add :signingStyle string automatic' build/ExportOptions.plist
                                xcodebuild -project ios/FreeX.xcodeproj -scheme FreeX -configuration Release \\
                                    -archivePath build/FreeX.xcarchive -allowProvisioningUpdates DEVELOPMENT_TEAM="$FREEX_IOS_TEAM" archive
                                xcodebuild -exportArchive -archivePath build/FreeX.xcarchive -exportPath build/export \\
                                    -exportOptionsPlist build/ExportOptions.plist -allowProvisioningUpdates
                                cp build/export/*.ipa "dist/FreeX-iOS-$VERSION.ipa"
                            fi
                            ls -l dist
                        '''
                    }
                    post {
                        success {
                            archiveArtifacts artifacts: 'dist/*', fingerprint: true
                        }
                    }
                }
            }
        }
    }
}
