Arownd - Android adaptive icon

Copy the "res" folder contents into app/src/main/res/ (merge with existing folders).

AndroidManifest.xml, inside <application>:
    android:icon="@mipmap/ic_launcher"
    android:roundIcon="@mipmap/ic_launcher_round"

Background: #FFFF00   Foreground: W in #000000
Includes: adaptive icon (API 26+), monochrome layer (themed icons, Android 13+),
legacy PNGs (mdpi..xxxhdpi), and playstore-icon-512.png for Google Play.
