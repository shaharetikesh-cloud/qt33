# QT DLR Android branding assets

Use this folder as the single source for launcher icon and splash assets.

Required source files:

- `icon-foreground.png` (1024x1024, transparent background)
- `icon-background.png` (1024x1024, solid/gradient background)
- `splash.png` (2732x2732, centered QT DLR logo)

How to apply:

1. Open Android Studio with this project.
2. Right-click `android/app/src/main/res` -> `New` -> `Image Asset`.
3. For launcher icon:
   - Foreground: `resources/android/icon-foreground.png`
   - Background: `resources/android/icon-background.png`
4. For splash image:
   - Replace `android/app/src/main/res/drawable/splash.png` with `resources/android/splash.png`.
5. Re-run:
   - `npm run android:sync`
   - `npm run android:apk:debug`

Notes:

- Current APK already builds with default icons.
- Replace these assets before Play Store submission for production branding quality.
