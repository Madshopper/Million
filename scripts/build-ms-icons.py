#!/usr/bin/env python3
"""Bygger static/js/ms-icons.js: Ionicons som SVG-stier til hjemmesidens
opskrift-sider i C2, så de har samme ikoner som appen (31-10-2026).

Kør fra roden efter `npm ci` i apps/mobile (fonten ligger i
@expo/vector-icons):  pip install fonttools && python3 scripts/build-ms-icons.py
Tilføj et ikon ved at sætte navnet i NAMES og køre scriptet igen.
"""
import json
import re
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

NAMES = [
    'timer-outline', 'leaf-outline', 'people-outline', 'heart-outline', 'bag-handle-outline',
    'barbell-outline', 'nutrition-outline', 'fish-outline', 'ban-outline', 'water-outline',
    'flame-outline', 'grid-outline', 'thermometer-outline', 'tv-outline', 'beaker-outline',
    'color-wand-outline', 'cog-outline', 'git-merge-outline', 'bonfire-outline', 'time-outline',
    'cafe-outline', 'albums-outline', 'shuffle', 'pencil', 'lock-closed', 'lock-open-outline',
    'restaurant-outline', 'chevron-back', 'checkmark', 'close', 'add', 'remove', 'search',
]
VI = Path('apps/mobile/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons')


def _num(m):
    v = float(m.group(0))
    return str(int(round(v))) if abs(v - round(v)) < 0.05 else '%.1f' % v


def main():
    glyphmap = json.loads((VI / 'glyphmaps/Ionicons.json').read_text())
    font = TTFont(VI / 'Fonts/Ionicons.ttf')
    cmap, glyphs, asc = font.getBestCmap(), font.getGlyphSet(), font['hhea'].ascent
    lines = []
    for name in sorted(NAMES):
        pen = SVGPathPen(glyphs)
        glyphs[cmap[glyphmap[name]]].draw(TransformPen(pen, (1, 0, 0, -1, 0, asc)))
        path = re.sub(r'-?\d+\.\d+', _num, pen.getCommands())
        lines.append('    %s: %s' % (json.dumps(name), json.dumps(path)))
    js = '''/*
 * Ikoner til opskrift-siderne i C2 (31-10-2026): samme Ionicons som appen
 * (apps/mobile bruger @expo/vector-icons). Ingen emoji i opskrift-delen.
 * GENERERET af scripts/build-ms-icons.py - ret ikke i hånden.
 *
 * Brug: MSIcon('timer-outline', 20) giver en <svg>-streng i currentColor.
 */
(function () {
  'use strict';
  var P = {
%s
  };
  window.MSIcon = function (name, size, cls) {
    var d = P[name];
    if (!d) return '';
    var s = size || 20;
    return '<svg class="ms-icon' + (cls ? ' ' + cls : '') + '" width="' + s + '" height="' + s +
      '" viewBox="0 6 512 512" fill="currentColor" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>';
  };
})();
''' % ',\n'.join(lines)
    Path('static/js/ms-icons.js').write_text(js)
    print('static/js/ms-icons.js:', len(js), 'tegn,', len(NAMES), 'ikoner')


if __name__ == '__main__':
    main()
