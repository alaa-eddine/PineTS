// SPDX-License-Identifier: AGPL-3.0-only

type PlotCharOptions = {
    title?: string;
    char?: string;
    location?: string;
    color?: string;
    offset?: number;
    text?: string;
    textcolor?: string;
    editable?: boolean;
    size?: number;
    show_last?: boolean;
    display?: boolean;
    format?: string;
    precision?: number;
    force_overlay?: boolean;
};

type PlotOptions = {
    color?: string;
    linewidth?: number;
    style?: string;
    trackprice?: boolean;
    histbase?: boolean;
    offset?: number;
    join?: boolean;
    editable?: boolean;
    show_last?: boolean;
    display?: boolean;
    format?: string;
    precision?: number;
    force_overlay?: boolean;
};

type IndicatorOptions = {
    overlay?: boolean;
    format?: string;
    precision?: number;
    scale?: number;
    max_bars_back?: number;
    timeframe?: string;
    timeframe_gaps?: boolean;
    explicit_plot_zorder?: number;
    max_lines_count?: number;
    max_labels_count?: number;
    max_boxes_count?: number;
    calc_bars_count?: number;
    max_polylines_count?: number;
    dynamic_requests?: boolean;
    behind_chart?: boolean;
};
