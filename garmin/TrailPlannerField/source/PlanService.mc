import Toybox.Application;
import Toybox.Background;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;

// Tâche de fond : télécharge le plan (via le téléphone) depuis le document partagé
// dont l'identifiant est le « code montre ». Seul le champ `w` est demandé.
(:background)
class PlanService extends System.ServiceDelegate {
    const PROJECT = "trail-planner-814f6";

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
            "v" => { "integerValue" => "1" }
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

    function fetchPlan(code as String) as Void {
        var url = "https://firestore.googleapis.com/v1/projects/" + PROJECT +
            "/databases/%28default%29/documents/shares/" + code;
        Communications.makeWebRequest(
            url,
            { "mask.fieldPaths" => "w" },
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
            }
        }
        // Code de réponse transmis en cas d'échec, pour l'afficher sur le champ.
        Background.exit(text != null ? text : responseCode);
    }
}
