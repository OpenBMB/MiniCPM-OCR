'OTSL table data structures ported from PaddleX paddleocr_vl/uilts.py.'

from __future__ import annotations

import html
from typing import Any, Dict, List

from pydantic import BaseModel, computed_field, model_validator


class TableCell(BaseModel):
    'A single cell in a table, with optional row/col span.'

    row_span: int = 1
    col_span: int = 1
    start_row_offset_idx: int
    end_row_offset_idx: int
    start_col_offset_idx: int
    end_col_offset_idx: int
    text: str
    column_header: bool = False
    row_header: bool = False
    row_section: bool = False

    @model_validator(mode="before")
    @classmethod
    def _from_dict_format(cls, data: Any) -> Any:

        if isinstance(data, Dict):
            if "text" in data:
                return data
            text = data["bbox"].get("token", "")
            if not text:
                text_cells = data.pop("text_cell_bboxes", None)
                if text_cells:
                    for el in text_cells:
                        text += el["token"] + " "
                text = text.strip()
            data["text"] = text
        return data


class TableData(BaseModel):
    'Container for all cells in a table plus its row/column dimensions.'

    table_cells: List[TableCell] = []
    num_rows: int = 0
    num_cols: int = 0

    @computed_field  # type: ignore[misc]
    @property
    def grid(self) -> List[List[TableCell]]:
        'Return a 2-D grid of TableCell objects (num_rows × num_cols).'
        table_data: List[List[TableCell]] = [
            [
                TableCell(
                    text="",
                    start_row_offset_idx=i,
                    end_row_offset_idx=i + 1,
                    start_col_offset_idx=j,
                    end_col_offset_idx=j + 1,
                )
                for j in range(self.num_cols)
            ]
            for i in range(self.num_rows)
        ]
        for cell in self.table_cells:
            for i in range(
                min(cell.start_row_offset_idx, self.num_rows),
                min(cell.end_row_offset_idx, self.num_rows),
            ):
                for j in range(
                    min(cell.start_col_offset_idx, self.num_cols),
                    min(cell.end_col_offset_idx, self.num_cols),
                ):
                    table_data[i][j] = cell
        return table_data


def export_to_html(table_data: TableData) -> str:
    'Render a TableData object as an HTML ``<table>`` string.'
    if not table_data.table_cells:
        return ""

    nrows = table_data.num_rows
    ncols = table_data.num_cols
    grid = table_data.grid
    body = ""
    for i in range(nrows):
        body += "<tr>"
        for j in range(ncols):
            cell: TableCell = grid[i][j]
            if cell.start_row_offset_idx != i or cell.start_col_offset_idx != j:
                continue
            content = html.escape(cell.text.strip())
            celltag = "th" if cell.column_header else "td"
            opening = celltag
            if cell.row_span > 1:
                opening += f' rowspan="{cell.row_span}"'
            if cell.col_span > 1:
                opening += f' colspan="{cell.col_span}"'
            body += f"<{opening}>{content}</{celltag}>"
        body += "</tr>"
    return f"<table>{body}</table>"
