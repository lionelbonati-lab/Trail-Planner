import Toybox.Application;
import Toybox.Background;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;

// Tâche de fond : télécharge le plan (via le téléphone) depuis le document partagé
// dont l'identifiant est le « code montre ». Seul le champ `w` est demandé. Puis lit le dernier
// message de l'assistance (msg/{code}) et y note, s'il y en a, les accusés « reçu » / « lu ».
(:background)
class PlanService extends System.ServiceDelegate {
    const PROJECT = "trail-planner-814f6";
    // Message de plus d'une heure (retrouvé au démarrage d'une activité) : ignoré.
    const MSG_STALE = 3600;

    var planResult = null;    // plan lu (texte) ou code d'erreur
    var msgResult = null;     // [identifiant, texte] du message de l'assistance, ou null
    var ackSent = null;       // accusé en cours d'envoi : { id, got, read }

    function initialize() {
        ServiceDelegate.initialize();
    }

    function onTemporalEvent() as Void {
        var code = Application.Properties.getValue("code");
        if (!(code instanceof String) || code.length() < 8) {
            Background.exit(null);
            return;
        }
        // En course : on envoie d'abord le suivi (relevé de moins de 15 min), puis on relit le plan.
        var progress = Application.Storage.getValue("progress");
        if (progress instanceof Dictionary && progress["t"] instanceof Number &&
            Time.now().value() - (progress["t"] as Number) < 900) {
            sendProgress(code, progress);
        } else {
            fetchPlan(code);
        }
    }

    function sendProgress(code as String, progress as Dictionary) as Void {
        var fields = {
            "t" => { "integerValue" => progress["t"].toString() },
            "s" => { "integerValue" => progress["s"].toString() },
            "d" => { "integerValue" => progress["d"].toString() },
            "p" => { "stringValue" => progress["p"] },
            // 2 : sortie libre (rien sur la montre), distance de l'activité et D+ dans p (« a=123 »).
            "v" => { "integerValue" => progress["f"] != null ? "2" : "1" }
        };
        if (progress["lat"] != null && progress["lon"] != null) {
            fields.put("lat", { "doubleValue" => progress["lat"] });
            fields.put("lon", { "doubleValue" => progress["lon"] });
        }
        if (progress["bat"] != null) {
            fields.put("bat", { "integerValue" => progress["bat"].toString() });
        }
        var name = "projects/" + PROJECT + "/databases/(default)/documents/live/" + code;
        Communications.makeWebRequest(
            "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/%28default%29/documents:commit",
            { "writes" => [{ "update" => { "name" => name, "fields" => fields } }] },
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onProgressSent)
        );
    }

    function onProgressSent(responseCode as Number, data as Dictionary or String or Null) as Void {
        var code = Application.Properties.getValue("code");
        fetchPlan(code as String);
    }

    // Plan (`w`) et, pour une sortie libre, rayon masqué autour du départ (`fh`).
    function fetchPlan(code as String) as Void {
        var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT +
            "/databases/%28default%29/documents/shares/" + code + "?mask.fieldPaths=w&mask.fieldPaths=fh";
        Communications.makeWebRequest(
            url,
            null,
            {
                :method => Communications.HTTP_REQUEST_METHOD_GET,
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onResponse)
        );
    }

    function onResponse(responseCode as Number, data as Dictionary or String or Null) as Void {
        var text = null;
        if (responseCode == 200 && data instanceof Dictionary) {
            var fields = data["fields"];
            if (fields instanceof Dictionary) {
                var w = fields["w"];
                if (w instanceof Dictionary) {
                    text = w["stringValue"];
                }
                // `w` vide : rien sur la montre, sortie libre. Transmis comme « -<rayon masqué en m> ».
                if (text instanceof String && text.length() == 0) {
                    var fh = fields["fh"];
                    var r = fh instanceof Dictionary ? fh["integerValue"] : null;
                    text = "-" + (r != null ? r.toString() : "500");
                }
            }
        }
        // Code de réponse transmis en cas d'échec, pour l'afficher sur le champ.
        planResult = text != null ? text : responseCode;
        fetchMessage();
    }

    // Dernier message de l'assistance (identifiant, texte, heure d'envoi).
    function fetchMessage() as Void {
        var code = Application.Properties.getValue("code") as String;
        var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT +
            "/databases/%28default%29/documents/msg/" + code + "?mask.fieldPaths=id&mask.fieldPaths=text&mask.fieldPaths=t";
        Communications.makeWebRequest(
            url,
            null,
            {
                :method => Communications.HTTP_REQUEST_METHOD_GET,
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onMessage)
        );
    }

    function onMessage(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (responseCode == 200 && data instanceof Dictionary) {
            var fields = data["fields"];
            if (fields instanceof Dictionary) {
                var id = fields["id"];
                var text = fields["text"];
                var t = fields["t"];
                // Entiers renvoyés en texte par l'API REST (« integerValue »).
                var sent = t instanceof Dictionary && t["integerValue"] != null ? t["integerValue"].toString().toNumber() : null;
                if (id instanceof Dictionary && text instanceof Dictionary && sent != null &&
                    Time.now().value() - sent < MSG_STALE) {
                    msgResult = [id["stringValue"], text["stringValue"]];
                }
            }
        }
        // Accusé en attente (message reçu, ou fermé d'un tour Lap) : noté dans le document du message.
        var ack = Application.Storage.getValue("msgAck");
        if (ack instanceof Dictionary && ack["id"] instanceof String) {
            sendAck(ack);
        } else {
            finish(null);
        }
    }

    // Accusés « reçu » (got) et « lu » (read) pour ce message seulement : l'identifiant est renvoyé tel
    // quel (les règles refusent l'écriture si un autre message l'a remplacé entre-temps).
    function sendAck(ack as Dictionary) as Void {
        var code = Application.Properties.getValue("code") as String;
        var name = "projects/" + PROJECT + "/databases/(default)/documents/msg/" + code;
        var fields = {
            "id" => { "stringValue" => ack["id"] },
            "got" => { "integerValue" => ack["got"].toString() }
        };
        var paths = ["id", "got"];
        if (ack["read"] instanceof Number && (ack["read"] as Number) > 0) {
            fields.put("read", { "integerValue" => ack["read"].toString() });
            paths.add("read");
        }
        ackSent = ack;
        Communications.makeWebRequest(
            "https://firestore.googleapis.com/v1/projects/" + PROJECT + "/databases/%28default%29/documents:commit",
            { "writes" => [{
                "update" => { "name" => name, "fields" => fields },
                "updateMask" => { "fieldPaths" => paths },
                "currentDocument" => { "exists" => true }
            }] },
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onAck)
        );
    }

    function onAck(responseCode as Number, data as Dictionary or String or Null) as Void {
        // Accusé écrit (ou refusé pour de bon : message remplacé) : la montre l'oublie.
        var done = ackSent != null && (responseCode == 200 || responseCode == 403 || responseCode == 404 || responseCode == 400);
        finish(done ? [ackSent["id"], ackSent["read"]] : null);
    }

    // Retour à l'appli : plan (texte ou code d'erreur), message éventuel, accusé envoyé.
    function finish(acked) as Void {
        var out = { "plan" => planResult };
        if (msgResult != null) {
            out.put("msg", msgResult);
        }
        if (acked != null) {
            out.put("acked", acked);
        }
        Background.exit(out);
    }
}
