import Toybox.Lang;
import Toybox.Math;

// Tracé de l'écran Carte : distance le long du parcours (m) et position (1e-5 degré) de chaque point.
// Vient du champ `wr` du document du code montre (« TPR1|<tolérance>|<d0>:<lat0>:<lon0>|<dd>,<dlat>,<dlon>,... »,
// watchRoute côté web, 3 m près sur une course normale) ; sans lui (plan publié par une ancienne version
// du site, ou pas encore téléchargé), de la ligne G du plan, plus grossière sur les ultras.
class MapRoute {
    var d as Array<Number> = [] as Array<Number>;
    var lat as Array<Number> = [] as Array<Number>;
    var lon as Array<Number> = [] as Array<Number>;

    function initialize() {
    }

    function size() as Number {
        return d.size();
    }

    // Position (1e-5 degré, [lat, lon]) à la distance x (m), interpolée entre deux points.
    function at(x as Float) as Array<Float> {
        var n = d.size();
        if (x <= d[0]) {
            return [lat[0].toFloat(), lon[0].toFloat()];
        }
        if (x >= d[n - 1]) {
            return [lat[n - 1].toFloat(), lon[n - 1].toFloat()];
        }
        var lo = 0;
        var hi = n - 1;
        while (hi - lo > 1) {
            var mid = (lo + hi) / 2;
            if (d[mid] <= x) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        var f = d[hi] > d[lo] ? (x - d[lo]) / (d[hi] - d[lo]).toFloat() : 0.0;
        return [lat[lo] + f * (lat[hi] - lat[lo]), lon[lo] + f * (lon[hi] - lon[lo])];
    }

    function point(v as Array<Number>) as Void {
        d.add(v[0]);
        lat.add(v[1]);
        lon.add(v[2]);
    }
}

// Champ wr ; null s'il n'est pas reconnu.
function parseMapRoute(text as String) as MapRoute or Null {
    var parts = splitText(text, "|");
    if (parts.size() < 4 || !parts[0].equals("TPR1")) {
        return null;
    }
    var o = splitText(parts[2], ":");
    if (o.size() != 3) {
        return null;
    }
    var r = new MapRoute();
    var first = [toNum(o[0]), toNum(o[1]), toNum(o[2])] as Array<Number>;
    r.point(first);
    readGroups(parts[3], 3, first, r.method(:point));
    return r.size() >= 2 ? r : null;
}

// Repli : tracé de la ligne G du plan (positions en mètres autour du premier point).
function mapRouteFromPlan(plan) as MapRoute or Null {
    if (plan == null || !plan.hasRoute()) {
        return null;
    }
    var r = new MapRoute();
    for (var i = 0; i < plan.routeD.size(); i++) {
        var la = plan.lat0 + plan.routeY[i] / ROUTE_KY;
        var lo = plan.lon0 + (plan.kx > 0 ? plan.routeX[i] / plan.kx : 0.0d);
        r.point([plan.routeD[i], (la * 100000.0d).toNumber(), (lo * 100000.0d).toNumber()] as Array<Number>);
    }
    return r;
}
