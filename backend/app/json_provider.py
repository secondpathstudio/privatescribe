from datetime import date, datetime

from flask.json.provider import DefaultJSONProvider


class ISODateJSONProvider(DefaultJSONProvider):
    """Serialize datetimes/dates as ISO 8601 instead of Flask's default RFC 1123."""
    def default(self, o):
        if isinstance(o, datetime):
            # Naive datetimes are stored as UTC by convention (datetime.utcnow()).
            # Append "Z" so the browser parses them as UTC; without it, JS reads
            # naive ISO strings as local time and the displayed clock is off by
            # the viewer's UTC offset.
            if o.tzinfo is None:
                return o.isoformat() + "Z"
            return o.isoformat()
        if isinstance(o, date):
            return o.isoformat()
        return super().default(o)
