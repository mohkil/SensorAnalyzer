// impedanceSpectroscopy.js - Functions for Impedance Spectroscopy Analysis

// This global variable will be populated by app.js after file selection
// It will store objects: { originalFile: File, effectiveName: string, originalName: string, type }
let spectroscopySensorFiles = []; 

// This global variable will store the processed data for spectroscopy analysis
// It's populated by processAllSpectroscopyFilesInternal and used by plot3DSpectroscopy
let spectroscopyDataCollections = []; 

// This will be set by initializeSpectroscopyFileHandling from app.js's global scope
let _config_spectroscopy = {};
let uniqueFrequencies = []; 

/**
 * Initializes the list of spectroscopy sensor files and shared config.
 * Called from app.js which passes pre-filtered and structured items, and shared config.
 * @param {Array<Object>} fileItems - Array of {originalFile, effectiveName, originalName, type} objects.
 * @param {Object} appConfig - The main configuration object from app.js.
 */
function initializeSpectroscopyFileHandling(fileItems, appConfig) {
    spectroscopySensorFiles = fileItems; 
    _config_spectroscopy = appConfig; 
    spectroscopyDataCollections = []; 
    uniqueFrequencies = []; 
    console.log("Initialized spectroscopy files for processing in impedanceSpectroscopy.js:", spectroscopySensorFiles.map(f=>f.effectiveName));
}


/**
 * Main function to orchestrate spectroscopy analysis, called by app.js
 */
async function processSpectroscopyAnalysis() {
    // logProgress and incrementProgress are global functions from app.js
    // logProgress(`Starting processing of ${spectroscopySensorFiles.length} spectroscopy files...`); // Logged in app.js
    spectroscopyDataCollections = await processAllSpectroscopyFilesInternal(spectroscopySensorFiles);
    
    if (spectroscopyDataCollections.length > 0) {
        collectUniqueFrequencies(); 
        populateFrequencySlider('impedance'); 
        populateFrequencySlider('phase');
    }
    
    const gasConcChartContainer = document.getElementById('gas-conc-profile-chart-container'); 
    if (gasConcChartContainer) gasConcChartContainer.style.display = 'none'; 
}


/**
 * Parses a single impedance spectroscopy CSV file.
 * Assumes initial lines might be metadata before a header row.
 * Expected headers (case-insensitive): 'frequency (hz)', 'z', 'angle'
 * @param {File} fileObject - The File object to parse.
 * @param {string} passedInEffectiveName - The name to use for logging/identification (usually original for spectroscopy).
 * @returns {Promise<Object|null>} A promise that resolves with an object
 * containing {fileName (original), effectiveName, timestamp, frequencies, impedances, phases}, or null if parsing fails.
 */
async function parseSpectroscopyFile(fileObject, passedInEffectiveName) {
    const originalFileName = fileObject.name;
    const currentEffectiveFileName = passedInEffectiveName; 

    const timestampMatch = originalFileName.match(/__IS_(\d{2})_(\d{2})_(\d{4}) (\d{2})_(\d{2})_(\d{2}(?:\.\d)?)\.csv$/i);
    let fileTimestamp = null;
    if (timestampMatch) {
        const day = parseInt(timestampMatch[1], 10);
        const month = parseInt(timestampMatch[2], 10) - 1; 
        const year = parseInt(timestampMatch[3], 10);
        const hour = parseInt(timestampMatch[4], 10);
        const minute = parseInt(timestampMatch[5], 10);
        const secParts = timestampMatch[6].split('.');
        const second = parseInt(secParts[0], 10);
        const millisecond = secParts[1] ? parseInt(secParts[1].padEnd(3, '0').substring(0,3), 10) : 0;
        
        fileTimestamp = new Date(year, month, day, hour, minute, second, millisecond);
        if (isNaN(fileTimestamp.getTime())) {
            console.warn(`Could not parse valid date from filename: ${originalFileName}`);
            fileTimestamp = null;
        }
    } else {
        console.warn(`Timestamp pattern not found in filename: ${originalFileName}. Using file modification date as fallback.`);
        fileTimestamp = new Date(fileObject.lastModified); 
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const fileString = event.target.result;
                const lines = fileString.split(/\r\n|\n/);
                let dataStartIndex = -1;
                
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].trim().toLowerCase().startsWith('frequency (hz)')) {
                        dataStartIndex = i + 1; 
                        break;
                    }
                }

                if (dataStartIndex === -1) {
                    for (let i = 0; i < lines.length; i++) {
                        const values = lines[i].split(',');
                        if (values.length >= 3 && !isNaN(parseFloat(values[0])) && !isNaN(parseFloat(values[1])) && !isNaN(parseFloat(values[2]))) {
                            dataStartIndex = i;
                            console.warn(`Header "frequency (hz)" not found in ${currentEffectiveFileName}. Attempting to parse data from line ${i+1}.`);
                            break;
                        }
                    }
                    if (dataStartIndex === -1) {
                        throw new Error(`Data table start (marked by 'frequency (hz)' or numeric rows) not found in ${currentEffectiveFileName}`);
                    }
                }
                
                const frequencies = [], impedances = [], phases = [];
                for (let i = dataStartIndex; i < lines.length; i++) {
                    if (lines[i].trim() === '') continue;
                    const values = lines[i].split(',');
                    if (values.length >= 3) { 
                        const freq = parseFloat(values[0]); 
                        const z = parseFloat(values[1]);    
                        const angle = parseFloat(values[2]);

                        if (!isNaN(freq) && !isNaN(angle) && !isNaN(z)) {
                            frequencies.push(freq); phases.push(angle); impedances.push(z);
                        } 
                    }
                }
                if (frequencies.length === 0) {
                    throw new Error(`No valid data rows found in ${currentEffectiveFileName} after data start index.`);
                }
                resolve({ 
                    fileName: originalFileName, 
                    effectiveName: currentEffectiveFileName, 
                    timestamp: fileTimestamp, 
                    frequencies, 
                    impedances, 
                    phases 
                });
            } catch (e) {
                console.error(`Error parsing spectroscopy file ${currentEffectiveFileName}:`, e);
                resolve(null); 
            }
        };
        reader.onerror = () => reject(new Error(`Error reading file ${currentEffectiveFileName}`));
        reader.readAsText(fileObject);
    });
}

/**
 * Processes all detected impedance spectroscopy files.
 * @param {Array<Object>} spectroscopyFileItems - Array of {originalFile, effectiveName, originalName, type}.
 * @returns {Promise<Array<Object>>} Processed data suitable for 3D plotting.
 */
async function processAllSpectroscopyFilesInternal(spectroscopyFileItems) { 
    const allProcessedData = [];
    let t0Milliseconds = null;

    for (let i = 0; i < spectroscopyFileItems.length; i++) {
        const fileItem = spectroscopyFileItems[i];
        logProgress(`Processing spectroscopy file: ${fileItem.effectiveName}...`); 
        const parsedData = await parseSpectroscopyFile(fileItem.originalFile, fileItem.effectiveName);

        if (parsedData && parsedData.timestamp) {
            if (t0Milliseconds === null) {
                t0Milliseconds = parsedData.timestamp.getTime();
            }
            const relativeTimeMs = parsedData.timestamp.getTime() - t0Milliseconds;
            const relativeTimeMin = relativeTimeMs / (1000 * 60);

            allProcessedData.push({
                ...parsedData, 
                relativeTimeMin: relativeTimeMin
            });
            logProgress(`Completed processing: ${fileItem.effectiveName}`);
        } else {
            logProgress(`Skipped or failed to parse: ${fileItem.effectiveName}`, 'error');
        }
        incrementProgress(''); 
    }
    allProcessedData.sort((a, b) => a.relativeTimeMin - b.relativeTimeMin);
    return allProcessedData;
}

function collectUniqueFrequencies() {
    const freqSet = new Set();
    spectroscopyDataCollections.forEach(sweep => {
        sweep.frequencies.forEach(f => freqSet.add(f));
    });
    uniqueFrequencies = Array.from(freqSet).sort((a, b) => a - b);
}

function populateFrequencySlider(plotContext) { 
    const slider = document.getElementById(`frequency-slider-${plotContext}`);
    const display = document.getElementById(`selected-frequency-display-${plotContext}`);
    const container = document.getElementById(`frequency-slice-selector-container-${plotContext}`);

    if (!slider || !display || !container) {
        console.error(`Frequency slider/display elements not found for ${plotContext}.`);
        return;
    }

    if (uniqueFrequencies.length === 0) {
        container.style.display = 'none';
        return;
    }
    // Container visibility is handled by app.js based on analysis type and active tab
    // container.style.display = 'block'; 

    slider.min = 0;
    slider.max = uniqueFrequencies.length - 1;
    slider.step = 1;
    slider.value = 0; 

    const updatePlotsForSelectedFrequency = () => {
        const selectedIndex = parseInt(slider.value, 10);
        if (selectedIndex >= 0 && selectedIndex < uniqueFrequencies.length) {
            const selectedFreq = uniqueFrequencies[selectedIndex];
            display.textContent = `${selectedFreq.toExponential(2)} Hz`;
            
            const slicePlotContainerId = `${plotContext}-2d-slice-plot-container`;
            plot2DSpectroscopyTimeSlice(selectedFreq, plotContext, slicePlotContainerId);
        }
    };

    slider.removeEventListener('input', updatePlotsForSelectedFrequency); 
    slider.addEventListener('input', updatePlotsForSelectedFrequency);
    
    // Trigger initial plot for the default frequency
    if (uniqueFrequencies.length > 0) {
        const initialFreq = uniqueFrequencies[0];
        display.textContent = `${initialFreq.toExponential(2)} Hz`;
        plot2DSpectroscopyTimeSlice(initialFreq, plotContext, `${plotContext}-2d-slice-plot-container`);
    }
}


function plot3DSpectroscopy(processedSpectroscopyData, containerId, plotType, experimentName) {
    const plotDiv = document.getElementById(containerId);
    if (!plotDiv) {
        console.error(`Plot container with ID ${containerId} not found.`);
        return;
    }
    plotDiv.innerHTML = ''; 

    if (!processedSpectroscopyData || processedSpectroscopyData.length === 0) {
        plotDiv.textContent = `No ${plotType} spectroscopy data to display.`;
        return;
    }

    const dataByFrequency = {};
    processedSpectroscopyData.forEach(sweep => {
        for (let i = 0; i < sweep.frequencies.length; i++) {
            const freq = sweep.frequencies[i];
            if (!dataByFrequency[freq]) {
                dataByFrequency[freq] = [];
            }
            dataByFrequency[freq].push({
                time: sweep.relativeTimeMin,
                value: plotType === 'impedance' ? sweep.impedances[i] : sweep.phases[i],
                originalFileName: sweep.fileName 
            });
        }
    });

    const traces = [];
    const sortedUniqueFrequenciesForPlot = Object.keys(dataByFrequency).map(f => parseFloat(f)).sort((a,b) => a - b);


    sortedUniqueFrequenciesForPlot.forEach(freq => {
        const pointsForFreq = dataByFrequency[freq].sort((a,b) => a.time - b.time); 

        if (pointsForFreq.length > 1) { 
            traces.push({
                x: pointsForFreq.map(p => p.time),         
                y: Array(pointsForFreq.length).fill(freq), 
                z: pointsForFreq.map(p => p.value),        
                mode: 'lines',
                type: 'scatter3d',
                name: `${freq.toExponential(1)} Hz`,
                line: { width: 2 },
                hoverinfo: 'text',
                text: pointsForFreq.map(p => 
                    `Freq: ${freq.toExponential(2)} Hz<br>` +
                    `Time: ${p.time.toFixed(2)} min<br>` +
                    `${plotType === 'impedance' ? 'Z' : 'Phase'}: ${p.value.toFixed(2)} ${plotType === 'impedance' ? 'Ohm' : 'deg'}`
                )
            });
        } else if (pointsForFreq.length === 1) { 
             traces.push({
                x: [pointsForFreq[0].time],
                y: [freq],
                z: [pointsForFreq[0].value],
                mode: 'markers',
                type: 'scatter3d',
                name: `${freq.toExponential(1)} Hz (single point)`,
                marker: { size: 4 },
                hoverinfo: 'text',
                text: `Freq: ${freq.toExponential(2)} Hz<br>Time: ${pointsForFreq[0].time.toFixed(2)} min<br>${plotType === 'impedance' ? 'Z' : 'Phase'}: ${pointsForFreq[0].value.toFixed(2)} ${plotType === 'impedance' ? 'Ohm' : 'deg'}`
            });
        }
    });
    
    if (traces.length === 0) {
        plotDiv.textContent = `Not enough data points to create 3D line plot for ${plotType}.`;
        return;
    }

    const zAxisTitle = plotType === 'impedance' ? 'Impedance (Ohm)' : 'Phase (deg)';
    const plotTitle = `${experimentName} - 3D ${plotType.charAt(0).toUpperCase() + plotType.slice(1)} vs. Time & Frequency`;

    const layout = {
        title: plotTitle,
        margin: { l: 0, r: 0, b: 0, t: 60 },
        scene: {
            xaxis: { title: 'Time (min)', autorange: 'reversed' }, 
            yaxis: { title: 'Frequency (Hz)', type: 'log' }, 
            zaxis: { title: zAxisTitle }                     
        },
        height: 700, 
        autosize: true,
        showlegend: true,
         legend: {
            orientation: 'v',
            itemsizing: 'constant',
            tracegroupgap: 0, 
            y: 0.5, 
            yanchor: 'middle',
            x: 1.05, 
            xanchor: 'left'
        }
    };

    Plotly.newPlot(containerId, traces, layout, {responsive: true});
    const createdPlotDiv = document.getElementById(containerId);
    if (createdPlotDiv && Plotly.Plots.resize) { 
        Plotly.Plots.resize(createdPlotDiv);
    } else if (createdPlotDiv) {
        console.warn("Plotly.Plots.resize not available or failed for 3D plot. Layout might not be optimal initially.");
    }
}


/**
 * Plots Impedance/Phase vs. Time at a selected constant frequency (2D plot).
 * @param {number} selectedFrequency - The frequency to plot data for.
 * @param {'impedance'|'phase'} plotDataType - 'impedance' or 'phase'.
 * @param {string} containerId - The ID of the HTML div to render the 2D plot.
 */
function plot2DSpectroscopyTimeSlice(selectedFrequency, plotDataType, containerId) {
    const plotDiv = document.getElementById(containerId);
    if (!plotDiv) {
        console.error(`2D Slice Plot container with ID ${containerId} not found.`);
        return;
    }
    plotDiv.innerHTML = ''; 

    if (!spectroscopyDataCollections || spectroscopyDataCollections.length === 0) {
        plotDiv.textContent = `No spectroscopy data processed.`;
        return;
    }

    const timeValues = [];
    const dataValues = [];
    const hoverTexts = [];

    spectroscopyDataCollections.forEach(sweep => {
        for (let i = 0; i < sweep.frequencies.length; i++) {
            if (Math.abs(sweep.frequencies[i] - selectedFrequency) < 1e-9) { 
                timeValues.push(sweep.relativeTimeMin);
                dataValues.push(plotDataType === 'impedance' ? sweep.impedances[i] : sweep.phases[i]);
                hoverTexts.push(
                    `Time: ${sweep.relativeTimeMin.toFixed(2)} min<br>` +
                    `Freq: ${sweep.frequencies[i].toExponential(2)} Hz<br>` +
                    `${plotDataType === 'impedance' ? 'Z' : 'Phase'}: ${(plotDataType === 'impedance' ? sweep.impedances[i] : sweep.phases[i]).toFixed(2)} ${plotDataType === 'impedance' ? 'Ohm' : 'deg'}<br>` +
                    `File: ${sweep.fileName}`
                );
                break; 
            }
        }
    });

    if (timeValues.length === 0) {
        plotDiv.textContent = `No data found for frequency ${selectedFrequency.toExponential(2)} Hz.`;
        return;
    }

    const sortedIndices = timeValues.map((_, i) => i).sort((a, b) => timeValues[a] - timeValues[b]);
    const sortedTime = sortedIndices.map(i => timeValues[i]);
    const sortedData = sortedIndices.map(i => dataValues[i]);
    const sortedHoverTexts = sortedIndices.map(i => hoverTexts[i]);


    const trace = {
        x: sortedTime,
        y: sortedData,
        mode: 'lines+markers',
        type: 'scatter',
        name: `${plotDataType.charAt(0).toUpperCase() + plotDataType.slice(1)} at ${selectedFrequency.toExponential(1)} Hz`,
        text: sortedHoverTexts,
        hoverinfo: 'text'
    };

    const yAxisTitle = plotDataType === 'impedance' ? 'Impedance (Ohm)' : 'Phase (deg)';
    // Title for 2D slice plot is handled by an h3 in the HTML now.

    const layout = {
        // title: plotTitle, // Title is now an H3 in HTML
        xaxis: { title: 'Time (min)' /* Removed autorange: 'reversed' */ },
        yaxis: { title: yAxisTitle },
        margin: { t: 30, l: 60, r: 30, b: 50 }, 
        height: 350,
        autosize: true
    };

    Plotly.newPlot(containerId, [trace], layout, {responsive: true});
}
