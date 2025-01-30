async function loadChartData() {
    try {
        const data = await PineTS.Provider.Binance.getMarketData('BTCUSDT', '240', 300);
        return data;
    } catch (error) {
        console.error('Error loading chart data:', error);
        return [];
    }
}

async function loadIndicatorData() {
    try {
        const data = await WillVixFix('BTCUSDT', '240', 300);
        console.log(data);
        return data;
    } catch (error) {
        console.error('Error loading indicator data:', error);
        return null;
    }
}

// Vertical line customization options
const verticalLineOptions = {
    width: '2px',
    color: 'rgba(255, 255, 255, 0.5)',
    dashLength: '6px', // Length of each dash
    dashGap: '6px', // Gap between dashes
};

// Common options for both charts
const chartOptions = {
    layout: {
        background: { color: '#1e1e3c' },
        textColor: '#DDD',
    },
    grid: {
        vertLines: { color: '#2B2B43' },
        horzLines: { color: '#2B2B43' },
    },
    rightPriceScale: {
        borderColor: '#2B2B43',
        // Disable price scale movement
        handleScale: false,
        handleScroll: false,
    },
    timeScale: {
        borderColor: '#2B2B43',
        // Disable time scale drag move
        handleScroll: false,
        // Disable mouse wheel zooming
        handleScale: false,
        // Disable trackball movement
        trackingMode: false,
    },
    // Disable all user interactions
    handleScale: false,
    handleScroll: false,
    crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
            visible: true,
        },
        horzLine: {
            visible: true,
            labelVisible: true,
        },
    },
};

const charts = [];
function createMainChart() {
    const mainChartContainer = document.getElementById('main-chart');
    // Create title container
    const titleContainer = document.createElement('div');
    titleContainer.style.position = 'absolute';
    titleContainer.style.zIndex = '2';
    titleContainer.style.left = '12px';
    titleContainer.style.top = '12px';
    titleContainer.style.color = '#DDD';
    titleContainer.style.fontSize = '14px';
    titleContainer.style.fontFamily = 'system-ui';
    mainChartContainer.style.position = 'relative';
    mainChartContainer.appendChild(titleContainer);

    // Create main chart
    const mainChart = LightweightCharts.createChart(mainChartContainer, {
        ...chartOptions,
        height: 400,
        width: mainChartContainer.clientWidth,
    });

    // Add series to main chart
    const mainSeries = mainChart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
    });

    // Add window resize handler
    function handleResize() {
        const width = mainChartContainer.clientWidth;

        charts.forEach((chart) => {
            chart.applyOptions({ width: width });
        });
    }

    window.addEventListener('resize', handleResize);

    charts.push(mainChart);

    return { mainChart, mainSeries };
}

function createIndicatorChart() {
    const mainChartContainer = document.getElementById('main-chart');
    const indicatorChartContainer = document.getElementById('indicator-chart');

    const indicatorChart = LightweightCharts.createChart(indicatorChartContainer, {
        ...chartOptions,
        height: 300,
        width: mainChartContainer.clientWidth,
    });

    charts.push(indicatorChart);

    return indicatorChart;
}

async function initializeCharts() {
    const { mainChart, mainSeries } = createMainChart();
    const indicatorChart = createIndicatorChart();
    window.indicatorChart = indicatorChart;

    // Load both datasets
    const [klines, indicatorData] = await Promise.all([loadChartData(), loadIndicatorData()]);

    // Format candlestick data
    const candleData = klines.map((k) => ({
        time: k.openTime,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
    }));

    // Set all data
    mainSeries.setData(candleData);

    for (let plotName in indicatorData) {
        addIndicator(indicatorChart, indicatorData[plotName]);
    }

    // Fit the content
    mainChart.timeScale().fitContent();
    indicatorChart.timeScale().fitContent();
}

function addIndicator(indicatorChart, plot, overlay = false) {
    if (overlay) {
        console.warn('not implemented');
        return;
    }
    switch (plot.options.style) {
        case 'line':
            {
                // Create RSI series
                const chart = indicatorChart.addLineSeries({
                    color: plot.options.color,
                    lineWidth: plot.options.linewidth,
                    lastValueVisible: true,
                });
                // Map the data to include the color from each point's options
                const coloredData = plot.data.map((point) => ({
                    ...point,
                    color: point.options?.color || plot.options.color, // fallback to default color if point.options.color is undefined
                }));
                chart.setData(coloredData);
            }
            break;
        case 'histogram':
            {
                const chart = indicatorChart.addHistogramSeries({
                    color: plot.options.color,
                    lineWidth: plot.options.linewidth,
                    lastValueVisible: true,
                });
                // Map the data to include the color from each point's options
                const coloredData = plot.data.map((point) => ({
                    ...point,
                    color: point.options?.color || plot.options.color, // fallback to default color if point.options.color is undefined
                }));
                chart.setData(coloredData);
            }
            break;
        case 'cross':
            {
                //Cross chart is not available in LightweightCharts, we're using a line series with large linewidth
                const chart = indicatorChart.addLineSeries({
                    position: 'aboveBar',
                    color: plot.options.color,
                    linewidth: plot.options.linewidth * 10 || 10,
                    lastValueVisible: true,
                });

                const crossData = plot.data.map((point) => ({
                    time: point.time,
                    value: point.options?.baseline || 0,
                    color: point.options?.color || plot.options.color,
                }));

                chart.setData(crossData);
            }
            break;
    }
}

// Initialize everything when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeCharts();
});
