import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;

// Paliers de zoom du profil (m de parcours affichés, 0 = parcours entier ; -1 = tronçon en cours, d'un
// point de passage au suivant ; -2 = d'un ravito à l'autre), choisis dans le menu (appui long sur Haut
// depuis le profil, ou Affichage › Zoom du profil) ou dans Garmin Connect.
const ZOOM_SPANS = [0, 20000, 10000, 5000, 2000, -1, -2] as Array<Number>;

// Repères des points de passage : ravito (rond), base de vie (carré).
const RAVITO_COLOR = 0xFF5500;
const BASE_COLOR = 0xFF0000;

// Palier de zoom choisi (indice dans ZOOM_SPANS).
function zoomLevel() as Number {
    var z = Application.Properties.getValue("zoom");
    return (z instanceof Number && z >= 0 && z < ZOOM_SPANS.size()) ? z as Number : 2;
}

// Portion du parcours affichée, [début, longueur] (m) : palier en km, le coureur au premier tiers ;
// tronçon en cours (point de passage précédent → suivant) ; d'un ravito (ou base de vie) à l'autre. Le
// départ et l'arrivée bornent les tronçons ; 500 m au moins.
function profileWindow(plan as Plan, pos as Float) as Array<Float> {
    var total = plan.total.toFloat();
    var s = ZOOM_SPANS[zoomLevel()];
    if (s < 0) {
        var a = 0.0;
        var b = total;
        for (var c = 0; c < plan.cpDist.size(); c++) {
            if (s == -2 && !plan.cpBase[c] && !plan.cpKind[c].equals("r")) {
                continue;
            }
            var d = plan.cpDist[c].toFloat();
            if (d <= pos) {
                a = d;
            } else {
                b = d;
                break;
            }
        }
        if (b - a < 500.0) {
            b = a + 500.0 < total ? a + 500.0 : total;
            a = b - 500.0 > 0.0 ? b - 500.0 : 0.0;
        }
        return [a, b - a] as Array<Float>;
    }
    var span = (s <= 0 || s > total) ? total : s.toFloat();
    var start = pos - span / 3.0;
    if (start > total - span) {
        start = total - span;
    }
    if (start < 0.0) {
        start = 0.0;
    }
    return [start, span] as Array<Float>;
}

function slopesOn() as Boolean {
    return Application.Properties.getValue("slopes") == true;
}

// Thème d'EndurancePro (réglage Mode sombre, activé par défaut), suivi par tous les écrans de l'appli.
function darkTheme() as Boolean {
    return Application.Properties.getValue("dark_mode_prop") != false;
}

function themeBg() as Number {
    return darkTheme() ? Graphics.COLOR_BLACK : Graphics.COLOR_WHITE;
}

function themeFg() as Number {
    return darkTheme() ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;
}

// Couleur secondaire (textes d'état) : gris clair sur fond noir, gris foncé sur fond blanc.
function themeDim() as Number {
    return darkTheme() ? Graphics.COLOR_LT_GRAY : Graphics.COLOR_DK_GRAY;
}

// Couleur d'une pente (%), seuils trail : montée vert < 5 %, jaune 5-10 %, orange 10-15 %, rouge 15-25 %,
// violet 25 % et plus ; descente bleu clair de -5 à -15 %, bleu foncé au-delà ; entre -5 et 5 % : vert.
// Couleurs prises parmi les 64 des écrans MIP (fēnix, Enduro).
function slopeColor(g as Float) as Number {
    if (g >= 25.0) {
        return 0xAA00FF;
    }
    if (g >= 15.0) {
        return 0xFF0000;
    }
    if (g >= 10.0) {
        return 0xFFAA00;
    }
    if (g >= 5.0) {
        return 0xFFFF00;
    }
    if (g > -5.0) {
        return 0x00AA00;
    }
    if (g > -15.0) {
        return 0x00AAFF;
    }
    return 0x0055FF;
}

// Ordonnée (px) d'une altitude : la plus haute de la portion à 5 % sous le haut du cadre, la plus basse
// à 5 % au-dessus du bas.
function altY(e as Float, lo as Float, hi as Float, top as Number, bottom as Number) as Number {
    var h = (bottom - top).toFloat();
    return (bottom - 0.05 * h - (e - lo) / (hi - lo) * 0.9 * h).toNumber();
}

// Profil de la course autour du coureur, dans le cadre [gauche, haut, droite, bas] : portion de `span` m,
// coureur au tiers gauche (comme la page assistance : on voit surtout ce qui l'attend), altitudes
// ajustées à la portion affichée (100 m d'écart au moins, pour ne pas grossir le plat). Partie faite en
// gris (foncé sur fond noir, clair sur fond blanc) ; devant, l'autre gris ou couleur de la pente. Points de passage sans nom (ravito : rond
// orange, base de vie : carré rouge, autres : petit rond), grisés une fois passés ; altitudes la plus
// haute et la plus basse de la portion à gauche (altitudes réelles seulement). Ni km ni nom de point.
function drawProfile(dc as Graphics.Dc, plan as Plan, pos as Float, a as Float, span as Float, slopes as Boolean, box as Array<Number>) as Void {
    // Couleurs selon le thème : partie faite, partie à venir, contours, fond, texte.
    var dark = darkTheme();
    var doneFill = dark ? 0x555555 : 0xAAAAAA;
    var doneLine = dark ? 0xAAAAAA : 0x555555;
    var aheadFill = dark ? 0xAAAAAA : 0x555555;
    var fg = dark ? Graphics.COLOR_WHITE : Graphics.COLOR_BLACK;
    var bg = dark ? Graphics.COLOR_BLACK : Graphics.COLOR_WHITE;
    var left = box[0];
    var top = box[1];
    var right = box[2];
    var bottom = box[3];
    var total = plan.total.toFloat();
    if (pos < 0.0) {
        pos = 0.0;
    } else if (pos > total) {
        pos = total;
    }
    var width = right - left;
    // Une colonne tous les 2 px (3 px sur les grands écrans AMOLED).
    var step = width > 300 ? 3 : 2;
    var n = width / step;
    var per = span / n;   // m par colonne

    // Altitudes aux bords des colonnes, plus basse et plus haute de la portion.
    var alts = [] as Array<Float>;
    var minE = 0.0;
    var maxE = 0.0;
    for (var i = 0; i <= n; i++) {
        var e = plan.altAt(a + per * i);
        alts.add(e);
        if (i == 0 || e < minE) {
            minE = e;
        }
        if (i == 0 || e > maxE) {
            maxE = e;
        }
    }
    var lo = minE;
    var hi = maxE;
    if (hi - lo < 100.0) {
        var mid = (hi + lo) / 2.0;
        lo = mid - 50.0;
        hi = mid + 50.0;
    }

    // Ligne de l'altitude la plus haute, derrière le profil.
    dc.setColor(doneFill, Graphics.COLOR_TRANSPARENT);
    dc.drawLine(left, altY(maxE, lo, hi, top, bottom), right, altY(maxE, lo, hi, top, bottom));

    // Remplissage, colonne par colonne. Pente d'une colonne : moyenne sur 1/20 de la portion affichée au
    // moins (100 m à 2 km, 500 m à 10 km), et sur la largeur de la colonne de part et d'autre : les
    // bosses de quelques mètres ne zèbrent pas une montée.
    var half = span / 40.0;
    if (half < per) {
        half = per;
    }
    for (var i = 0; i < n; i++) {
        var x = left + i * step;
        var dm = a + per * (i + 0.5);
        var y = altY((alts[i] + alts[i + 1]) / 2.0, lo, hi, top, bottom);
        var color = aheadFill;
        if (dm <= pos) {
            color = doneFill;
        } else if (slopes) {
            color = slopeColor((plan.altAt(dm + half) - plan.altAt(dm - half)) / (2.0 * half) * 100.0);
        }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(x, y, step, bottom - y + 1);
    }

    // Contour : gris sur la partie faite, blanc (noir sur fond blanc) devant.
    if (dc has :setPenWidth) {
        dc.setPenWidth(2);
    }
    for (var i = 0; i < n; i++) {
        var x = left + i * step;
        dc.setColor(a + per * (i + 0.5) <= pos ? doneLine : fg, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(x, altY(alts[i], lo, hi, top, bottom), x + step, altY(alts[i + 1], lo, hi, top, bottom));
    }
    if (dc has :setPenWidth) {
        dc.setPenWidth(1);
    }
    dc.setColor(doneFill, Graphics.COLOR_TRANSPARENT);
    dc.drawLine(left, bottom, right, bottom);

    // Altitudes la plus haute et la plus basse de la portion, hors du profil : la plus haute juste au-dessus
    // de sa ligne, la plus basse sous la ligne de base ; du côté opposé au coureur (pas sur son repère).
    if (plan.realAltitude()) {
        var font = Graphics.FONT_XTINY;
        var fh = dc.getFontHeight(font);
        var yMax = altY(maxE, lo, hi, top, bottom);
        var runnerLeft = pos - a < span / 2.0;
        var lx = runnerLeft ? right - 2 : left + 2;
        var just = runnerLeft ? Graphics.TEXT_JUSTIFY_RIGHT : Graphics.TEXT_JUSTIFY_LEFT;
        dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(lx, yMax - fh - 1, font, maxE.toNumber().toString(), just);
        dc.drawText(lx, bottom + 1, font, minE.toNumber().toString(), just);
    }

    // Points de passage de la portion (sans nom).
    var r = width > 300 ? 6 : 4;
    for (var c = 0; c < plan.cpDist.size(); c++) {
        var d = plan.cpDist[c].toFloat();
        if (d < a || d > a + span) {
            continue;
        }
        var x = (left + (d - a) / span * width).toNumber();
        var y = altY(plan.altAt(d), lo, hi, top, bottom);
        var passed = d <= pos;
        dc.setColor(bg, Graphics.COLOR_TRANSPARENT);
        if (plan.cpBase[c]) {
            dc.fillRectangle(x - r - 1, y - r - 1, 2 * r + 3, 2 * r + 3);
            dc.setColor(passed ? doneLine : BASE_COLOR, Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(x - r, y - r, 2 * r + 1, 2 * r + 1);
        } else if (plan.cpKind[c].equals("r")) {
            dc.fillCircle(x, y, r + 1);
            dc.setColor(passed ? doneLine : RAVITO_COLOR, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(x, y, r);
        } else {
            dc.fillCircle(x, y, r - 1);
            dc.setColor(passed ? doneLine : fg, Graphics.COLOR_TRANSPARENT);
            dc.drawCircle(x, y, r - 1);
        }
    }

    // Coureur : trait vertical, point sur le profil et triangle sous la ligne de base (comme la barre
    // du champ de données).
    var rx = (left + (pos - a) / span * width).toNumber();
    var ry = altY(plan.altAt(pos), lo, hi, top, bottom);
    var t = width > 300 ? 9 : 6;
    dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
    dc.drawLine(rx, top, rx, bottom);
    dc.fillPolygon([[rx, bottom + 2], [rx - t, bottom + 2 + t + t / 2], [rx + t, bottom + 2 + t + t / 2]]);
    dc.setColor(bg, Graphics.COLOR_TRANSPARENT);
    dc.fillCircle(rx, ry, r + 2);
    dc.setColor(fg, Graphics.COLOR_TRANSPARENT);
    dc.fillCircle(rx, ry, r);
}
