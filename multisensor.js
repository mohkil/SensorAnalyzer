// multisensor.js - Functions for Time-Series (Impedance vs. Time) Analysis

// These global variables will be populated by app.js after file selection
// and passed to initializeTimeSeriesFileHandling
let timeSeriesSensorFiles = []; 
let sensorDataTables = []; // Array of { fileName (effectiveName), originalFileName, sensorNumber (display), data: [...] }

// These will be set by initializeTimeSeriesFileHandling from app.js's global scope
let _gasFlowFile_ts = null; 
let _gasConcVsTime_ts = []; 
let _config_ts = {}; 
let _gasExposureEvents_ts = []; 
let _gasConcPrecision_ts = 1;   
let _gasConcentrationLabel_ts = "Gas Conc. (ppm)"; 


/**
 * Initializes the list of time-series sensor files and shared config/data.
 * Called from app.js which passes pre-filtered and structured items, and shared data.
 * @param {Array<Object>} fileItems - Array of {originalFile, effectiveName, originalName, sensorNumberRaw, sensorNumberDisplay, type} objects.
 * @param {File|null} gasFlowTableFile - The gas_flow_table.csv File object from app.js.
 * @param {Array<Object>} gasConcentrationProfile - The calculated gasConcVsTime array from app.js.
 * @param {Object} appConfig - The main configuration object from app.js.
 */
function initializeTimeSeriesFileHandling(fileItems, gasFlowTableFile, gasConcentrationProfile, appConfig) {
    timeSeriesSensorFiles = fileItems; 
    _gasFlowFile_ts = gasFlowTableFile; 
    _gasConcVsTime_ts = gasConcentrationProfile; 
    _config_ts = appConfig; 
    _gasExposureEvents_ts = appConfig.gasExposureEvents || []; 
    _gasConcPrecision_ts = appConfig.gasConcPrecision || 1;
    _gasConcentrationLabel_ts = appConfig.gasConcentrationLabel || "Gas Conc. (ppm)";
    console.log("Initialized time-series files for processing in multisensor.js:", timeSeriesSensorFiles.map(f=>f.effectiveName));
}

/**
 * Interpolates gas concentration using a 'previous value' method with extrapolation.
 * This function mirrors the behavior of MATLAB's `interp1(..., 'previous', 'extrap')`.
 * @param {Array<Object>} concProfile - Sorted array of {time_min, conc} points representing the gas concentration profile.
 * @param {number} targetTimeMin - The time for which to interpolate/extrapolate the concentration.
 * @returns {number} Interpolated or extrapolated concentration value, or NaN if profile is empty or targetTimeMin is NaN.
 */
function interpolateGasConcentration(concProfile, targetTimeMin) { 
    if (isNaN(targetTimeMin)) return NaN; 
    if (!concProfile || concProfile.length === 0) return NaN; 

    if (targetTimeMin < concProfile[0].time_min) {
        return concProfile[0].conc; 
    }

    let resultConc = concProfile[0].conc; 
    for (let i = 0; i < concProfile.length; i++) {
        if (concProfile[i].time_min <= targetTimeMin) {
            resultConc = concProfile[i].conc; 
        } else {
            break;
        }
    }
    return resultConc;
}


/**
 * Main function to orchestrate time-series analysis, called by app.js
 */
async function processTimeSeriesAnalysis() { 
    await processTimeSeriesSensorFilesInternal(); 
}


async function processTimeSeriesSensorFilesInternal() { 
    sensorDataTables = []; 
    const refTimeMinutes = timeStringToMinutes(_config_ts.refTimeStr);  // Use _config_ts
    if (isNaN(refTimeMinutes)) {
        throw new Error(`Invalid Baseline Time format: "${_config_ts.refTimeStr}". Please use HH:MM:SS.s or MM:SS.s.`);
    }

    for (let i = 0; i < timeSeriesSensorFiles.length; i++) {
        const fileItem = timeSeriesSensorFiles[i]; 
        const file = fileItem.originalFile;
        const effectiveFileName = fileItem.effectiveName;
        const originalFileName = fileItem.originalName;

        logProgress(`Processing Time-Series File: ${effectiveFileName}...`); // Uses global logProgress from app.js

        const rawDataArray = await parseCsvFile(file, false); // Uses global parseCsvFile from app.js
        if (!rawDataArray || rawDataArray.length === 0) {
            console.warn(`File ${effectiveFileName} is empty or parsing failed. Skipping.`);
            logProgress(`Processing ${effectiveFileName}: Skipped (empty or unreadable)`);
            incrementProgress(''); // Uses global incrementProgress from app.js
            continue;
        }

        const timeColIdx = 0;
        const impedanceColIdx = 7;
        const phaseColIdx = 8;
        const minRequiredCols = Math.max(timeColIdx, impedanceColIdx, phaseColIdx) + 1;

        if (rawDataArray[0].length < minRequiredCols) {
            logProgress(`Processing ${effectiveFileName}: Error (insufficient columns)`);
            incrementProgress('');
            throw new Error(`File ${effectiveFileName} does not have enough columns in its first data row (expected at least ${minRequiredCols}). Found ${rawDataArray[0].length}. Please check CSV structure.`);
        }

        const t0String = rawDataArray[0][timeColIdx];
        const t0Date = parseCustomDateTime(t0String); // Uses global parseCustomDateTime from app.js
        const t0Milliseconds = t0Date ? t0Date.getTime() : NaN;

        if (isNaN(t0Milliseconds)) {
            console.warn(`Warning: Initial timestamp "${t0String}" in ${effectiveFileName} could not be parsed. Relative time calculations for this file will result in NaN.`);
        }

        const processedTable = rawDataArray.map((row, rowIndex) => {
            if (row.length < minRequiredCols) {
                console.warn(`Row ${rowIndex + 1} in ${effectiveFileName} does not have enough columns. Data for this row will be NaN.`);
                return {
                    original_time_s: (row && row.length > timeColIdx) ? row[timeColIdx] : "Invalid Row Structure",
                    time_s: NaN, time_min: NaN, impedance: NaN, phase: NaN, signal: NaN, gas_concentration: NaN
                };
            }
            const currentDateString = row[timeColIdx];
            const currentDate = parseCustomDateTime(currentDateString);
            const currentMilliseconds = currentDate ? currentDate.getTime() : NaN;
            let relative_time_s = NaN;
            if (!isNaN(currentMilliseconds) && !isNaN(t0Milliseconds)) {
                relative_time_s = (currentMilliseconds - t0Milliseconds) / 1000;
            }
            const time_min = relative_time_s / 60;
            return {
                original_time_s: currentDateString, time_s: relative_time_s, time_min: time_min,
                impedance: parseFloat(row[impedanceColIdx]), phase: parseFloat(row[phaseColIdx]),
            };
        });

        let refIdx = -1;
        const suitablePointsForRef = processedTable.filter(row => !isNaN(row.time_min) && row.time_min <= refTimeMinutes);
        if (suitablePointsForRef.length > 0) {
            refIdx = processedTable.indexOf(suitablePointsForRef[suitablePointsForRef.length - 1]);
        } else if (processedTable.length > 0 && !isNaN(processedTable[0].time_min)) {
            refIdx = 0;
            console.warn(`For ${effectiveFileName}, no data points found at or before reference time. Using first valid data point.`);
        }
        const imp_ref = (refIdx !== -1 && processedTable.length > 0 && !isNaN(processedTable[refIdx].impedance))
                        ? processedTable[refIdx].impedance : NaN;
        if (isNaN(imp_ref)) {
            console.warn(`Reference impedance for ${effectiveFileName} is NaN.`);
        }

        processedTable.forEach(row => {
            row.signal = (!isNaN(imp_ref) && imp_ref !== 0 && !isNaN(row.impedance))
                         ? ((row.impedance - imp_ref) / imp_ref) * 100 : NaN;
            if (row.impedance > 1e12) row.impedance = NaN;
            if (Math.abs(row.signal) > 1e4) row.signal = NaN;
            // Use the _gasFlowFile_ts and _gasConcVsTime_ts passed during initialization
            row.gas_concentration = (_gasFlowFile_ts && !isNaN(row.time_min)) 
                                    ? interpolateGasConcentration(_gasConcVsTime_ts, row.time_min) 
                                    : NaN;
        });

        sensorDataTables.push({ 
            fileName: effectiveFileName, 
            originalFileName: originalFileName, 
            sensorNumber: fileItem.sensorNumberDisplay, 
            data: processedTable 
        });
        logProgress(`Processing ${effectiveFileName}: Completed`);
        incrementProgress(''); 
    }
}


/**
 * Displays time-series sensor data charts (2D plots).
 * Called from app.js when a time-series tab is clicked.
 * @param {'impedance'|'phase'|'signal'} dataType - The type of data to plot.
 */
function displaySensorCharts(dataType) { 
    if (typeof Plotly === 'undefined') {
        const chartGridContainer = document.getElementById(`${dataType}-charts`);
        if (chartGridContainer) {
            chartGridContainer.innerHTML = `<p style="text-align:center; padding:20px; color:red;">Plotly.js library not loaded. Cannot display charts.</p>`;
        }
        console.error("Plotly is not defined. Make sure the library is loaded.");
        return;
    }

    let dataKey, yLabelPrimary; 
    const primaryTraceColor = '#007bff'; 
    const secondaryTraceColor = '#ff7f0e'; 

    switch (dataType.toLowerCase()) {
        case 'phase':
            dataKey = 'phase'; yLabelPrimary = 'Phase (deg)'; break;
        case 'signal':
            dataKey = 'signal'; yLabelPrimary = 'Signal (%)'; break;
        default: 
            dataType = 'impedance'; 
            dataKey = 'impedance'; yLabelPrimary = 'Impedance (Ohm)'; break;
    }

    const containerId = `${dataType}-charts`; 
    const chartGridContainer = document.getElementById(containerId);
    chartGridContainer.innerHTML = ''; 

    if (sensorDataTables.length === 0) {
        chartGridContainer.innerHTML = `<p style="text-align:center; padding:20px;">No time-series sensor data processed or available to display.</p>`;
        return;
    }

    let plotStartTimeUser = parseFloat(plotStartTimeInput.value); 
    let plotEndTimeUser = parseFloat(plotEndTimeInput.value);   
    const gasConcPrecision = _config_ts.gasConcPrecision || 1; // Use _config_ts


    sensorDataTables.forEach((sensorTable, index) => {
        const chartWrapper = document.createElement('div');
        chartWrapper.className = 'chart-container-wrapper'; 
        const chartDivId = `chart-${dataType}-${sensorTable.sensorNumber || index}`; 
        const chartDiv = document.createElement('div');
        chartDiv.id = chartDivId;
        chartWrapper.appendChild(chartDiv); 
        chartGridContainer.appendChild(chartWrapper); 

        const validTimeData = sensorTable.data.filter(row => !isNaN(row.time_min));

        if (validTimeData.length === 0) {
            chartDiv.innerHTML = `<p style="text-align:center; padding:10px;">Sensor ${sensorTable.sensorNumber}: No valid time data to plot.</p>`;
            return; 
        }
        
        const xValuesToPlot = validTimeData.map(row => row.time_min); 
        const dataMinX = xValuesToPlot.length > 0 ? Math.min(...xValuesToPlot) : 0;
        const dataMaxX = xValuesToPlot.length > 0 ? Math.max(...xValuesToPlot) : Infinity;

        let currentXAxisRange = [undefined, undefined];

        if (!isNaN(plotStartTimeUser) && !isNaN(plotEndTimeUser)) {
            if (plotEndTimeUser > plotStartTimeUser) {
                currentXAxisRange = [plotStartTimeUser, plotEndTimeUser];
            } else { 
                console.warn("Plot End Time is not greater than Start Time. Using auto range.");
            }
        } else if (!isNaN(plotStartTimeUser)) { 
            currentXAxisRange = [plotStartTimeUser, dataMaxX];
        } else if (!isNaN(plotEndTimeUser)) { 
            currentXAxisRange = [0, plotEndTimeUser]; 
        }
        
        const effectivePlotMinX = currentXAxisRange[0] !== undefined ? currentXAxisRange[0] : dataMinX;
        const effectivePlotMaxX = currentXAxisRange[1] !== undefined ? currentXAxisRange[1] : dataMaxX;

        const traces = [];
        const layoutShapes = [];
        const layoutAnnotations = [];
        let yaxis2Config = null;
        
        // Use _gasFlowFile_ts and _config_ts for gas concentration elements
        if (_gasFlowFile_ts && _config_ts.gasExposureEvents && _config_ts.gasExposureEvents.length > 0) {
            traces.push({
                x: validTimeData.map(row => row.time_min), 
                y: validTimeData.map(row => row.gas_concentration),
                name: _config_ts.gasConcentrationLabel, 
                type: 'scatter', mode: 'lines', yaxis: 'y2', 
                line: { color: secondaryTraceColor, dash: 'dashdot' } 
            });

            yaxis2Config = { 
                title: { text: _config_ts.gasConcentrationLabel, font: {size: 11, color: secondaryTraceColor} }, 
                overlaying: 'y', 
                side: 'right',
                showgrid: false, 
                automargin: true,
                tickfont: {size: 9}
            };

            _config_ts.gasExposureEvents.forEach(event => {
                const visibleXStart = Math.max(event.startTime, effectivePlotMinX);
                const visibleXEnd = Math.min(event.endTime, effectivePlotMaxX);

                if (visibleXStart < visibleXEnd) { 
                    layoutShapes.push({
                        type: 'rect', xref: 'x', yref: 'paper',
                        x0: visibleXStart, y0: 0, x1: visibleXEnd, y1: 1,
                        fillcolor: 'rgba(100, 100, 100, 0.1)', 
                        layer: 'below', 
                        line: { width: 0 }
                    });

                    layoutAnnotations.push({
                        x: (visibleXStart + visibleXEnd) / 2, 
                        y: event.concentration,               
                        yref: 'y2', xref: 'x',                
                        text: event.concentration.toFixed(gasConcPrecision), 
                        showarrow: false,
                        font: { color: secondaryTraceColor, size: 10 }, 
                        bgcolor: 'rgba(255,255,255,0.7)',     
                        xanchor: 'center',
                        yanchor: 'bottom', 
                        align: 'center'
                    });
                }
            });
        }
        
        traces.push({
            x: validTimeData.map(row => row.time_min),
            y: validTimeData.map(row => row[dataKey]), 
            name: yLabelPrimary, 
            type: 'scatter', mode: 'lines', yaxis: 'y1', 
            line: { color: primaryTraceColor } 
        });


        const layout = {
            title: {
                text: `Sensor ${sensorTable.sensorNumber} <br><span style="font-size:0.8em; color:#555;">(${sensorTable.fileName})</span>`,
                font: { size: 14 }
            },
            xaxis: { 
                title: 'Time (min)',
                range: (currentXAxisRange[0] !== undefined && currentXAxisRange[1] !== undefined) ? currentXAxisRange : undefined
            },
            yaxis: { 
                title: {text: yLabelPrimary, font: {color: primaryTraceColor}}, 
                side: 'left', 
                automargin: true 
            },
            margin: { l: 70, r: (_gasFlowFile_ts && _config_ts.gasExposureEvents && _config_ts.gasExposureEvents.length > 0 ? 70 : 40), t: 60, b: 50 }, 
            legend: { x: 0.5, y: -0.2, xanchor: 'center', yanchor: 'top', orientation: "h", font: {size:10} }, 
            height: 380, 
            autosize: true,
            shapes: layoutShapes, 
            annotations: layoutAnnotations 
        };

        if (yaxis2Config) {
            layout.yaxis2 = yaxis2Config;
        }


        Plotly.newPlot(chartDivId, traces, layout, {responsive: true}); 
        const plotDiv = document.getElementById(chartDivId);
        if (plotDiv) {
            Plotly.Plots.resize(plotDiv);
        }
    });
}
