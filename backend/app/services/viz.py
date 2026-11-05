"""Automatic chart recommendation from a result set."""
from __future__ import annotations

import re
from typing import Any

from ..db.engine import jsonable


def infer_types(columns: list[str], rows: list[list[Any]], given: list[str] | None = None) -> list[str]:
    if given and len(given) == len(columns):
        return list(given)
    out = []
    for i in range(len(columns)):
        values = [r[i] for r in rows[:50] if i < len(r) and r[i] is not None]
        if not values:
            out.append("text")
        elif all(isinstance(v, bool) for v in values):
            out.append("boolean")
        elif all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values):
            out.append("number")
        elif re.match(r"^\d{4}-\d{2}-\d{2}", str(values[0])):
            out.append("date")
        else:
            out.append("text")
    return out


def _numbers(rows: list[list[Any]], indices: list[int]) -> list[list[float]]:
    series = []
    for i in indices:
        vals = []
        for r in rows:
            v = r[i] if i < len(r) else None
            if isinstance(v, (bool, int, float)):
                vals.append(float(v))
            else:
                try:
                    vals.append(float(str(v).replace(",", "")))
                except (TypeError, ValueError):
                    vals.append(0.0)
        series.append(vals)
    return series


def recommend(
    columns: list[str],
    rows: list[list[Any]],
    column_types: list[str] | None = None,
    title: str = "",
) -> list[dict[str, Any]]:
    """Return a ranked list of chart specs (first one is the recommended chart)."""
    if not columns:
        return []
    types = infer_types(columns, rows, column_types)
    numeric = [i for i, t in enumerate(types) if t in ("number", "boolean")]
    dates = [i for i, t in enumerate(types) if t == "date"]
    categorical = [i for i, t in enumerate(types) if t == "text"]
    label_idx = (dates[0] if dates else (categorical[0] if categorical else 0))
    labels = [jsonable(r[label_idx]) if label_idx < len(r) else "" for r in rows] if rows else []

    def spec(kind: str, x: str, y: list[str], reason: str, **options: Any) -> dict[str, Any]:
        series = [
            {"name": y_col, "data": _numbers(rows, [columns.index(y_col)])[0]}
            for y_col in y
            if y_col in columns
        ]
        return {
            "type": kind,
            "title": title or (f"{', '.join(y)} by {x}" if x else y[0] if y else "Result"),
            "x": x,
            "y": y,
            "series": series,
            "reason": reason,
            "options": {"categories": [str(v) for v in labels[:200]], **options},
        }

    if not rows:
        return [spec("table", "", columns, "Empty result set")]

    specs: list[dict[str, Any]] = []

    # Single numeric value -> KPI card
    if len(rows) == 1 and numeric:
        value = rows[0][numeric[0]]
        return [
            {
                "type": "metric",
                "title": title or columns[numeric[0]],
                "x": "",
                "y": [columns[numeric[0]]],
                "series": [{"name": columns[numeric[0]], "data": [jsonable(value)]}],
                "reason": "A single aggregated value is best shown as a KPI card.",
                "options": {"value": jsonable(value), "categories": []},
            },
            spec("table", "", columns, "Raw values"),
        ]

    dim_idx = dates[0] if dates else (categorical[0] if categorical else None)
    dim = columns[dim_idx] if dim_idx is not None else ""
    y_cols = [columns[i] for i in numeric]

    if dim and y_cols:
        kind = "line" if dates else "bar"
        reason = (
            "Time column detected: a line chart shows the trend."
            if dates
            else "One categorical dimension with numeric measures: a bar chart is the clearest comparison."
        )
        specs.append(spec(kind, dim, y_cols, reason, horizontal=len(rows) > 12))
        if dates:
            specs.append(spec("area", dim, y_cols, "Area chart emphasises cumulative magnitude over time."))
            specs.append(spec("bar", dim, y_cols, "Bar chart compares each period directly."))
        else:
            specs.append(spec("line", dim, y_cols, "Line chart is useful when categories are ordered."))
            if len(y_cols) == 1 and len(rows) <= 8 and all(v >= 0 for v in specs[0]["series"][0]["data"]):
                specs.append(spec("pie", dim, y_cols, "Few non-negative categories: a pie chart shows share."))
    elif len(y_cols) >= 2:
        specs.append(spec("scatter", y_cols[0], y_cols[1:], "Two or more numeric columns: scatter shows correlation."))
    elif y_cols:
        specs.append(spec("bar", columns[categorical[0]] if categorical else dim, y_cols, "Distribution of a single measure."))

    specs.append(spec("table", dim, y_cols, "Raw tabular view."))
    # de-duplicate by type
    seen: set[str] = set()
    unique = []
    for s in specs:
        if s["type"] not in seen:
            seen.add(s["type"])
            unique.append(s)
    # Wide raw result sets (table browsing) are best read as a grid, not a chart.
    if len(columns) >= 5:
        table_spec = next((s for s in unique if s["type"] == "table"), None)
        if table_spec:
            unique = [table_spec] + [s for s in unique if s["type"] != "table"]
    return unique
