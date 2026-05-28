# App icons

Source art: `icon.png` (1024×1024). electron-builder consumes it three ways.

| File         | Used by   | Generated how                                                    |
| ------------ | --------- | ---------------------------------------------------------------- |
| `icon.png`   | Linux     | Source. electron-builder auto-resizes per AppImage/deb spec.     |
| `icon.icns`  | macOS     | macOS bundle icon (committed source-of-truth).                   |
| `icon.ico`   | Windows   | Multi-size (16/24/32/48/64/128/256) `.ico` built from `icon.png`. |

## Regenerating `icon.ico`

Pillow (already a transitive backend dep) emits a proper multi-size `.ico` in one
shot — no extra tooling needed:

```bash
backend/venv/bin/python -c "
from PIL import Image
img = Image.open('electron/assets/icon.png')
img.save('electron/assets/icon.ico',
         sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"
```

Verify it has all seven entries:

```bash
python3 -c "
import struct
with open('electron/assets/icon.ico','rb') as f: d=f.read()
n = struct.unpack('<H', d[4:6])[0]
print(f'{n} sizes')"
```
