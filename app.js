// app.js - Main Application Logic & Coordination

// --- Global Variables ---
let config = {}; 
let allUploadedFiles = []; 
let gasFlowFile = null; 
let currentAnalysisType = null; 
let categorizedFileItems = []; 
let gasConcVsTime = []; 


// --- DOM Element References ---
const stepUploadConfigureDiv = document.getElementById('step-upload-configure');
const stepProcessingProgressDiv = document.getElementById('step-processing-progress');
const step3DisplayDiv = document.getElementById('step3-display');

const dataFolderInput = document.getElementById('data-folder-input');
const processDataBtn = document.getElementById('process-data-btn');
const processingStatusStep1Div = document.getElementById('processing-status-step1');
const progressBar = document.getElementById('progress-bar');
const progressLogDiv = document.getElementById('progress-log');
const overallProgressStatusDiv = document.getElementById('overall-progress-status');

const gasConcProfileChartContainer = document.getElementById('gas-conc-profile-chart-container');

const tabButtonsTimeSeries = document.querySelectorAll('#tabs-timeseries .tab-button');
const tabButtonsSpectroscopy = document.querySelectorAll('#tabs-spectroscopy .tab-button');

const exportXlsxBtn = document.getElementById('export-xlsx-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const exportPlotsBtn = document.getElementById('export-plots-btn');
const newAnalysisBtn = document.getElementById('new-analysis-btn');
const aboutBtn = document.getElementById('about-btn');
const aboutInfoDiv = document.getElementById('about-info');

const plotRangeControlsTimeSeries = document.getElementById('plot-range-controls-timeseries');
const plotStartTimeInput = document.getElementById('plot-start-time-input');
const plotEndTimeInput = document.getElementById('plot-end-time-input');
const updatePlotRangeBtn = document.getElementById('update-plot-range-btn');

const tabsTimeSeriesDiv = document.getElementById('tabs-timeseries');
const tabsSpectroscopyDiv = document.getElementById('tabs-spectroscopy');
const frequencySliceSelectorContainerImpedance = document.getElementById('frequency-slice-selector-container-impedance');
const frequencySliceSelectorContainerPhase = document.getElementById('frequency-slice-selector-container-phase');


const analysisTypeModal = document.getElementById('analysis-type-modal');
const analyzeTimeSeriesBtn = document.getElementById('analyze-time-series-btn');
const analyzeSpectroscopyBtn = document.getElementById('analyze-spectroscopy-btn');

let totalProcessingSteps = 0;
let completedProcessingSteps = 0;

// --- Utility Functions (defined in app.js, accessible within this file) ---

function extractSensorNumberFromName(filename, forDisplay = true) {
    let match = filename.match(/__([0-9]+)__vs_time\.csv$/i); 
    if (!match) { 
        match = filename.match(/vs_time\.csv([0-9]+)$/i);
    }

    if (match && match[1]) {
        const parsedNumber = parseInt(match[1], 10);
        if (!isNaN(parsedNumber)) {
            return forDisplay ? parsedNumber + 1 : parsedNumber;
        }
    }
    return null; 
}

function sortFileItemsBySensorNumber(fileItems) {
    return fileItems.sort((a, b) => {
        const numA = a.sensorNumberRaw; 
        const numB = b.sensorNumberRaw;

        if (numA !== null && numB !== null) return numA - numB; 
        if (numA !== null) return -1; 
        if (numB !== null) return 1;  
        return a.originalName.localeCompare(b.originalName); 
    });
}


async function detectAnalysisType(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            resolve(null); 
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const fileString = event.target.result;
                const lines = fileString.split(/\r\n|\n/).slice(0, 20); 
                for (const line of lines) {
                    const lowerLine = line.toLowerCase();
                    if (lowerLine.includes('frequency (hz)') && 
                        (lowerLine.includes('z') || lowerLine.includes('impedance')) &&
                        lowerLine.includes('angle')) {
                        resolve('spectroscopy');
                        return;
                    }
                }
                resolve('time_series');
            } catch (e) {
                console.error("Error during file content read for type detection:", e);
                reject(new Error("Could not read file for type detection."));
            }
        };
        reader.onerror = (e) => {
            console.error("FileReader error for type detection:", e);
            reject(new Error("FileReader error during type detection."));
        };
        reader.readAsText(file);
    });
}

// --- Tab Handling Functions (defined early for availability) ---
/**
 * Initializes tab navigation functionality based on the currentAnalysisType.
 */
function initializeTabs() {
    tabsTimeSeriesDiv.style.display = 'none';
    tabsSpectroscopyDiv.style.display = 'none';
    plotRangeControlsTimeSeries.style.display = 'none'; 
    if(frequencySliceSelectorContainerImpedance) frequencySliceSelectorContainerImpedance.style.display = 'none';
    if(frequencySliceSelectorContainerPhase) frequencySliceSelectorContainerPhase.style.display = 'none';
    document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');

    let firstActiveTab = null;

    if (currentAnalysisType === 'time_series') {
        tabsTimeSeriesDiv.style.display = 'block';
        plotRangeControlsTimeSeries.style.display = 'block';
        tabButtonsTimeSeries.forEach(button => {
            button.removeEventListener('click', handleTabClickWrapper); 
            button.addEventListener('click', handleTabClickWrapper);
        });
        if (tabButtonsTimeSeries.length > 0) {
            tabButtonsTimeSeries.forEach(btn => btn.classList.remove('active')); 
            tabButtonsTimeSeries[0].classList.add('active'); 
            firstActiveTab = tabButtonsTimeSeries[0];
        }
    } else if (currentAnalysisType === 'spectroscopy') {
        tabsSpectroscopyDiv.style.display = 'block';
        // Show the correct frequency slider based on the initially active spectroscopy tab
        if (tabButtonsSpectroscopy.length > 0) {
            tabButtonsSpectroscopy.forEach(btn => btn.classList.remove('active'));
            tabButtonsSpectroscopy[0].classList.add('active');
            firstActiveTab = tabButtonsSpectroscopy[0];
            // Visibility of sliders handled in handleTabClick
        }
        
        tabButtonsSpectroscopy.forEach(button => {
            button.removeEventListener('click', handleTabClickWrapper);
            button.addEventListener('click', handleTabClickWrapper);
        });
    }
    if (firstActiveTab) {
        handleTabClick(firstActiveTab, currentAnalysisType === 'time_series' ? tabButtonsTimeSeries : tabButtonsSpectroscopy);
    }
}

/**
 * Wrapper for tab click handling to pass correct parameters.
 */
function handleTabClickWrapper(event) {
    const button = event.target;
    const allButtons = currentAnalysisType === 'time_series' ? tabButtonsTimeSeries : tabButtonsSpectroscopy;
    handleTabClick(button, allButtons);
}

/**
 * Generic tab click handler.
 * @param {HTMLElement} clickedButton - The button that was clicked.
 * @param {NodeListOf<Element>} allButtonsInGroup - All buttons in the current tab group.
 */
function handleTabClick(clickedButton, allButtonsInGroup) {
    const targetTab = clickedButton.getAttribute('data-tab'); 

    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
    });
    const activeTabContent = document.getElementById(`${targetTab}-charts`);
    if (activeTabContent) activeTabContent.style.display = 'block'; 

    allButtonsInGroup.forEach(btn => btn.classList.remove('active'));
    clickedButton.classList.add('active');

    // Show/hide frequency sliders based on active spectroscopy tab
    if (frequencySliceSelectorContainerImpedance) frequencySliceSelectorContainerImpedance.style.display = 'none';
    if (frequencySliceSelectorContainerPhase) frequencySliceSelectorContainerPhase.style.display = 'none';

    if (currentAnalysisType === 'time_series') {
        if (typeof displaySensorCharts === 'function') {
            displaySensorCharts(targetTab); 
        } else {
            console.error("displaySensorCharts function not found. Check multisensor.js");
        }
    } else if (currentAnalysisType === 'spectroscopy') {
        let plotType, containerIdFor3DPlot, containerIdFor2DSlicePlot;
        if (targetTab === 'impedance3d') {
            plotType = 'impedance'; 
            containerIdFor3DPlot = 'impedance-3d-plot-container'; 
            containerIdFor2DSlicePlot = 'impedance-2d-slice-plot-container';
            if(frequencySliceSelectorContainerImpedance) frequencySliceSelectorContainerImpedance.style.display = 'block';
        } else if (targetTab === 'phase3d') {
            plotType = 'phase'; 
            containerIdFor3DPlot = 'phase-3d-plot-container'; 
            containerIdFor2DSlicePlot = 'phase-2d-slice-plot-container';
            if(frequencySliceSelectorContainerPhase) frequencySliceSelectorContainerPhase.style.display = 'block';
        }
        
        if (plotType && containerIdFor3DPlot && containerIdFor2DSlicePlot) {
            if (typeof plot3DSpectroscopy === 'function') {
                plot3DSpectroscopy(spectroscopyDataCollections, containerIdFor3DPlot, plotType, config.experimentName);
            } else {
                console.error("plot3DSpectroscopy function not found. Check impedanceSpectroscopy.js");
            }
            const sliderId = plotType === 'impedance' ? 'frequency-slider-impedance' : 'frequency-slider-phase';
            const slider = document.getElementById(sliderId);
            // Ensure uniqueFrequencies is defined (it's in impedanceSpectroscopy.js)
            if (slider && typeof uniqueFrequencies !== 'undefined' && uniqueFrequencies.length > 0) { 
                const selectedFreq = uniqueFrequencies[parseInt(slider.value, 10)];
                if (typeof plot2DSpectroscopyTimeSlice === 'function') {
                     plot2DSpectroscopyTimeSlice(selectedFreq, plotType, containerIdFor2DSlicePlot);
                } else {
                    console.error("plot2DSpectroscopyTimeSlice function not found. Check impedanceSpectroscopy.js");
                }
            }
        }
    }
}


// --- Event Listeners ---

dataFolderInput.addEventListener('change', async (event) => {
    allUploadedFiles = Array.from(event.target.files);
    gasFlowFile = null;
    categorizedFileItems = []; 
    currentAnalysisType = null; 
    processDataBtn.disabled = true; 
    analysisTypeModal.style.display = 'none'; 
    analyzeTimeSeriesBtn.disabled = false; 
    analyzeSpectroscopyBtn.disabled = false; 


    let potentialTimeSeriesFileObjects = [];
    let potentialSpectroscopyFileObjects = [];
    let firstDataFileForTypeDetection = null;

    for (const file of allUploadedFiles) {
        if (file.name.toLowerCase() === 'gas_flow_table.csv') {
            gasFlowFile = file;
        } else {
            if (!firstDataFileForTypeDetection) {
                firstDataFileForTypeDetection = file;
            }
            const isSpectroscopyByName = file.name.match(/__IS_.*\.csv$/i); 
            const isTimeSeriesByName = file.name.includes('vs_time') && file.name.toLowerCase().endsWith('.csv');

            if (isSpectroscopyByName) {
                potentialSpectroscopyFileObjects.push(file);
            } else if (isTimeSeriesByName) {
                potentialTimeSeriesFileObjects.push(file);
            }
        }
    }
    
    const numTimeSeriesByName = potentialTimeSeriesFileObjects.length;
    const numSpectroscopyByName = potentialSpectroscopyFileObjects.length;

    if (numTimeSeriesByName > 0 && numSpectroscopyByName > 0) {
        updateStep1Status(`Mixed file types detected (${numTimeSeriesByName} time-series, ${numSpectroscopyByName} spectroscopy). Please choose an analysis type.`, 'info');
        analyzeTimeSeriesBtn.disabled = true; 
        analysisTypeModal.style.display = 'flex'; 
    } else if (numTimeSeriesByName > 0) {
        const detectedType = await detectAnalysisType(potentialTimeSeriesFileObjects[0]);
        if (detectedType === 'time_series') {
            finalizeAndCategorizeFiles('time_series');
        } else { 
            updateStep1Status(`Ambiguous files: ${potentialTimeSeriesFileObjects[0].name} named like time-series but content suggests spectroscopy. Please choose.`, 'error');
            analyzeTimeSeriesBtn.disabled = true; 
            analysisTypeModal.style.display = 'flex'; 
        }
    } else if (numSpectroscopyByName > 0) {
        const detectedType = await detectAnalysisType(potentialSpectroscopyFileObjects[0]);
        if (detectedType === 'spectroscopy') {
            finalizeAndCategorizeFiles('spectroscopy');
        } else {
             updateStep1Status(`Ambiguous files: ${potentialSpectroscopyFileObjects[0].name} named like spectroscopy but content suggests time-series. Please choose.`, 'error');
             analyzeTimeSeriesBtn.disabled = true; 
            analysisTypeModal.style.display = 'flex'; 
        }
    } else if (firstDataFileForTypeDetection) { 
        const detectedType = await detectAnalysisType(firstDataFileForTypeDetection);
        if (detectedType) {
            logProgress(`Attempting ${detectedType.replace('_', ' ')} analysis based on content of ${firstDataFileForTypeDetection.name}.`);
            finalizeAndCategorizeFiles(detectedType);
        } else {
            updateStep1Status("Could not determine analysis type from the files. Please check file names and contents.", 'error');
        }
    } else {
        updateStep1Status("No valid sensor data files (time-series or spectroscopy) found in the selection.", 'error');
    }
});

function finalizeAndCategorizeFiles(chosenType) {
    categorizedFileItems = []; 
    currentAnalysisType = chosenType; 

    allUploadedFiles.forEach(file => {
        if (file.name.toLowerCase() === 'gas_flow_table.csv') return; 

        const originalName = file.name;
        let effectiveName = originalName;
        let itemType = null; 
        let sensorNumberRaw = null;
        let sensorNumberDisplay = null;
        
        if (chosenType === 'time_series') {
            const alternateTimeSeriesMatch = originalName.match(/^(.*__vs_time)\.csv([0-9]+)$/i);
            if (alternateTimeSeriesMatch) {
                effectiveName = `${alternateTimeSeriesMatch[1]}__${alternateTimeSeriesMatch[2]}__vs_time.csv`;
            }
            const standardMatch = effectiveName.match(/__([0-9]+)__vs_time\.csv$/i);
            if (standardMatch) { 
                sensorNumberRaw = parseInt(standardMatch[1], 10);
                 if (!isNaN(sensorNumberRaw)) {
                    itemType = 'time_series';
                    sensorNumberDisplay = sensorNumberRaw + 1;
                 } else {
                    console.warn(`Could not extract sensor number from time-series candidate: ${effectiveName}`);
                 }
            } else {
                 console.log(`Skipping file as it does not conform to strict time-series naming after normalization: ${effectiveName} (original: ${originalName})`);
            }

        } else if (chosenType === 'spectroscopy') {
            const spectroscopyFormatMatch = originalName.match(/__IS_(\d{2}_\d{2}_\d{4} \d{2}_\d{2}_\d{2}(?:\.\d)?)\.csv$/i);
            if (spectroscopyFormatMatch) { 
                itemType = 'spectroscopy';
            } else {
                console.log(`Skipping file as it does not match spectroscopy naming pattern: ${originalName}`);
            }
        }

        if (itemType === chosenType) { 
            categorizedFileItems.push({
                originalFile: file, effectiveName, originalName,
                sensorNumberRaw, sensorNumberDisplay, type: itemType
            });
        }
    });
    
    categorizedFileItems = sortFileItemsBySensorNumber(categorizedFileItems); 

    let statusMessage = `Analysis type set to: ${currentAnalysisType.replace('_', ' ')}. Found ${categorizedFileItems.length} relevant files.`;
     if (gasFlowFile && currentAnalysisType === 'time_series') {
        statusMessage += ` Gas flow table (${gasFlowFile.name}) found.`;
    } else if (!gasFlowFile && currentAnalysisType === 'time_series') {
        statusMessage += ` Gas flow table NOT found. Gas concentration analysis will be skipped.`;
    }
    updateStep1Status(statusMessage, categorizedFileItems.length > 0 ? 'info' : 'error');
    processDataBtn.disabled = categorizedFileItems.length === 0;
}


analyzeTimeSeriesBtn.addEventListener('click', () => {
    analysisTypeModal.style.display = 'none';
    finalizeAndCategorizeFiles('time_series');
});

analyzeSpectroscopyBtn.addEventListener('click', () => {
    analysisTypeModal.style.display = 'none';
    finalizeAndCategorizeFiles('spectroscopy');
});


processDataBtn.addEventListener('click', async () => {
    if (categorizedFileItems.length === 0) {
        alert(`No valid files for the selected analysis type (${currentAnalysisType}). Please re-select files or choose a different analysis type if applicable.`);
        return;
    }

    stepUploadConfigureDiv.style.display = 'none';
    stepProcessingProgressDiv.style.display = 'block';
    step3DisplayDiv.style.display = 'none';
    progressLogDiv.innerHTML = '';
    updateProgressBar(0, 'Starting analysis...');

    processDataBtn.disabled = true;
    completedProcessingSteps = 0;
    totalProcessingSteps = 1; 
    if (currentAnalysisType === 'time_series' && gasFlowFile) {
        totalProcessingSteps += 2; 
    }
    totalProcessingSteps += categorizedFileItems.length;


    try {
        logProgress('Gathering configuration...');
        config.experimentName = document.getElementById('experiment-name').value.trim() || "ExperimentData";
        const targetGasNameInput = document.getElementById('target-gas-name');
        config.targetGasName = targetGasNameInput ? targetGasNameInput.value.trim() : "Target Gas";
        config.gasConcentrationLabel = `${config.targetGasName} concentration (ppm)`;
        
        config.gasConcCyl2 = parseFloat(document.getElementById('gas-conc-cyl-2').value);
        config.refTimeStr = document.getElementById('ref-time').value;
        config.gasConcPrecision = 1; 
        config.totalFlowrate = 500;
        config.gasConcCyl1 = 0;
        incrementProgress('Configuration gathered.');


        if (currentAnalysisType === 'time_series') {
            if (isNaN(config.gasConcCyl2) && gasFlowFile) {
                throw new Error("Invalid input for Initial Target Gas Concentration for time-series analysis.");
            }
            if (gasFlowFile) {
                logProgress(`Parsing ${gasFlowFile.name}...`);
                await parseGasFlowFile(gasFlowFile); 
                incrementProgress(`Parsed ${gasFlowFile.name}.`);

                logProgress('Calculating gas concentration profile...');
                calculateGasConcVsTime(); 
                config.gasExposureEvents = identifyGasExposureEvents(gasConcVsTime); 
                incrementProgress('Gas concentration profile calculated.');
                gasConcProfileChartContainer.style.display = 'block';
                plotGasConcentrationProfile(gasConcVsTime, gasConcProfileChartContainer);
            } else {
                logProgress('Gas flow table (gas_flow_table.csv) not found. Skipping gas concentration analysis for time-series.');
                gasConcVsTime = []; 
                config.gasExposureEvents = []; 
                if (gasConcProfileChartContainer) {
                    gasConcProfileChartContainer.innerHTML = '<p style="text-align:center; padding:10px;">Gas flow table not found. Gas concentration profile cannot be displayed.</p>';
                    gasConcProfileChartContainer.style.display = 'block';
                }
            }
            initializeTimeSeriesFileHandling(categorizedFileItems, gasFlowFile, gasConcVsTime, config); 
            await processTimeSeriesAnalysis(); 
        } else if (currentAnalysisType === 'spectroscopy') {
            initializeSpectroscopyFileHandling(categorizedFileItems, config); 
            await processSpectroscopyAnalysis();
        }
        
        updateOverallProgressStatus('Data processing complete! Transitioning to plots...', 'success');
        updateProgressBar(100, 'Completed.');

        setTimeout(() => {
            stepProcessingProgressDiv.style.display = 'none';
            step3DisplayDiv.style.display = 'block';
            initializeTabs(); 
            
            if (currentAnalysisType === 'time_series') {
                const firstActiveTimeSeriesTab = document.querySelector('#tabs-timeseries .tab-button.active');
                if (firstActiveTimeSeriesTab) handleTabClick(firstActiveTimeSeriesTab, tabButtonsTimeSeries);
            } else if (currentAnalysisType === 'spectroscopy') {
                 const firstActiveSpectroscopyTab = document.querySelector('#tabs-spectroscopy .tab-button.active');
                if (firstActiveSpectroscopyTab) handleTabClick(firstActiveSpectroscopyTab, tabButtonsSpectroscopy);
            }

        }, 1500);

    } catch (error) {
        updateOverallProgressStatus(`Error during processing: ${error.message}`, 'error');
        logProgress(`ERROR: ${error.message}`, 'error');
        console.error("Processing Error:", error);
    } finally {
        // processDataBtn.disabled = false; // Re-enabled on reset
    }
});


aboutBtn.addEventListener('click', () => {
    if (aboutInfoDiv.style.display === 'none' || aboutInfoDiv.style.display === '') {
        aboutInfoDiv.style.display = 'block';
    } else {
        aboutInfoDiv.style.display = 'none';
    }
});

newAnalysisBtn.addEventListener('click', () => {
    resetApplication();
});

updatePlotRangeBtn.addEventListener('click', () => {
    const activeTabButton = document.querySelector('.tab-navigation .tab-button.active');
    if (activeTabButton) {
        const dataType = activeTabButton.getAttribute('data-tab');
        if (currentAnalysisType === 'time_series') {
            displaySensorCharts(dataType); 
        } else if (currentAnalysisType === 'spectroscopy') {
            console.log("Update plot range for 3D plots - current implementation re-plots.");
             if (dataType === 'impedance3d') {
                plot3DSpectroscopy(spectroscopyDataCollections, 'impedance-3d-plot-container', 'impedance', config.experimentName);
            } else if (dataType === 'phase3d') {
                plot3DSpectroscopy(spectroscopyDataCollections, 'phase-3d-plot-container', 'phase', config.experimentName);
            }
        }
    } else {
        alert("No active plot tab found to update.");
    }
});

exportPlotsBtn.addEventListener('click', async () => {
    if (typeof JSZip === 'undefined') {
        alert("JSZip library not loaded. Cannot export plots to ZIP.");
        console.error("JSZip is not defined.");
        return;
    }

    const activeTabButton = document.querySelector('.tab-navigation .tab-button.active');
    if (!activeTabButton) {
        alert("No active plot tab found.");
        return;
    }
    const currentDataType = activeTabButton.getAttribute('data-tab');
    let plotDivs;
    let noDataMessage = "";

    if (currentAnalysisType === 'time_series') {
        if (sensorDataTables.length === 0) { noDataMessage = "No time-series data processed."; }
        const chartGridContainer = document.getElementById(`${currentDataType}-charts`);
        plotDivs = chartGridContainer ? chartGridContainer.querySelectorAll('.chart-container-wrapper > div[id^="chart-"]') : [];
    } else if (currentAnalysisType === 'spectroscopy') {
        if (spectroscopyDataCollections.length === 0) { noDataMessage = "No spectroscopy data processed."; }
        plotDivs = [];
        if (currentDataType === 'impedance3d') {
            const plot3d = document.getElementById('impedance-3d-plot-container');
            const plot2d = document.getElementById('impedance-2d-slice-plot-container');
            if (plot3d && plot3d.children.length > 0) plotDivs.push(plot3d);
            if (plot2d && plot2d.children.length > 0) plotDivs.push(plot2d);
        } else if (currentDataType === 'phase3d') {
            const plot3d = document.getElementById('phase-3d-plot-container');
            const plot2d = document.getElementById('phase-2d-slice-plot-container');
            if (plot3d && plot3d.children.length > 0) plotDivs.push(plot3d);
            if (plot2d && plot2d.children.length > 0) plotDivs.push(plot2d);
        }
    } else {
        alert("Unknown analysis type for plot export.");
        return;
    }
    
    if (noDataMessage) {
        alert(noDataMessage);
        return;
    }

    if (!plotDivs || plotDivs.length === 0) {
        alert(`No plots found in the "${currentDataType}" tab to export.`);
        return;
    }

    step3DisplayDiv.style.display = 'none';
    stepProcessingProgressDiv.style.display = 'block';
    progressLogDiv.innerHTML = ''; 
    updateProgressBar(0, `Starting export of ${plotDivs.length} plots to ZIP...`);
    updateOverallProgressStatus(`Exporting plots from "${currentDataType}" tab to ZIP...`, 'processing');

    const zip = new JSZip();
    let successCount = 0;

    for (let i = 0; i < plotDivs.length; i++) {
        const plotDiv = plotDivs[i];
        let plotNameSuffix = "";
        if (currentAnalysisType === 'time_series') {
            const plotIdParts = plotDiv.id.split('-');
            plotNameSuffix = `_Sensor${plotIdParts[plotIdParts.length - 1]}`;
        } else if (currentAnalysisType === 'spectroscopy') {
            if (plotDiv.id.includes('2d-slice')) {
                const sliderId = currentDataType === 'impedance3d' ? 'frequency-slider-impedance' : 'frequency-slider-phase';
                const slider = document.getElementById(sliderId);
                const selectedFreq = (typeof uniqueFrequencies !== 'undefined' && uniqueFrequencies.length > parseInt(slider.value,10)) 
                                     ? uniqueFrequencies[parseInt(slider.value, 10)] 
                                     : "unknown_freq";
                plotNameSuffix = `_Slice_at_${typeof selectedFreq === 'number' ? selectedFreq.toExponential(1) : selectedFreq}Hz`.replace('.','_');
            } else {
                 plotNameSuffix = "_3D"; 
            }
        }
        const filename = `${config.experimentName || "ExperimentData"}_${currentDataType.replace('3d','')}${plotNameSuffix}.png`;
        
        logProgress(`Generating image for ${filename}...`);
        try {
            const dataUrl = await Plotly.toImage(plotDiv, {
                format: 'png',
                height: plotDiv.offsetHeight || (currentAnalysisType === 'spectroscopy' ? 500 : 400),
                width: plotDiv.offsetWidth || (currentAnalysisType === 'spectroscopy' ? 700 : 600),
                scale: 4 
            });
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            zip.file(filename, blob);
            logProgress(`Added ${filename} to ZIP.`);
            successCount++;
        } catch (err) {
            console.error(`Error exporting plot ${filename}:`, err);
            logProgress(`Error exporting ${filename}: ${err.message}`, 'error');
        }
        updateProgressBar(((i + 1) / plotDivs.length) * 100);
    }

    if (successCount > 0) {
        logProgress('Generating ZIP file...');
        zip.generateAsync({ type: "blob" })
            .then(function(content) {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(content);
                link.download = `${config.experimentName || "ExperimentData"}_${currentDataType.replace('3d','')}_Plots.zip`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
                updateOverallProgressStatus(`${successCount} of ${plotDivs.length} plots successfully exported to ZIP. Returning to plots page...`, 'success');
                logProgress('ZIP file generated and download initiated.');
            })
            .catch(function(err) {
                console.error("Error generating ZIP:", err);
                updateOverallProgressStatus(`Error generating ZIP file: ${err.message}. Returning to plots page...`, 'error');
                logProgress(`Error generating ZIP: ${err.message}`, 'error');
            })
            .finally(() => {
                setTimeout(() => {
                   stepProcessingProgressDiv.style.display = 'none';
                   step3DisplayDiv.style.display = 'block'; 
                }, 2500); 
            });
    } else {
        updateOverallProgressStatus('No plots were successfully exported to add to ZIP. Returning to plots page...', 'error');
         setTimeout(() => {
           stepProcessingProgressDiv.style.display = 'none';
           step3DisplayDiv.style.display = 'block'; 
        }, 2500);
    }
});


// --- Helper Functions (continued) ---

function logProgress(message, type = 'info') {
    const logEntry = document.createElement('div');
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    if (type === 'error') logEntry.style.color = 'red';
    if (type === 'success') logEntry.style.color = 'green';
    progressLogDiv.appendChild(logEntry);
    progressLogDiv.scrollTop = progressLogDiv.scrollHeight;
}

function updateProgressBar(value, text = '') {
    const percentage = Math.min(100, Math.max(0, value));
    if (progressBar) {
        progressBar.style.width = `${percentage}%`;
        progressBar.textContent = `${Math.round(percentage)}%`;
    }
    if (text && text !== progressBar.textContent) logProgress(text); 
}

function incrementProgress(stepMessage) {
    completedProcessingSteps++;
    const progressPercentage = totalProcessingSteps > 0 ? (completedProcessingSteps / totalProcessingSteps) * 100 : 0;
    if (stepMessage) logProgress(stepMessage); 
    updateProgressBar(progressPercentage); 
}


function resetApplication() {
    config = {};
    allUploadedFiles = [];
    gasFlowFile = null;
    currentAnalysisType = null;
    categorizedFileItems = [];
    gasConcVsTime = []; 

    if (typeof initializeTimeSeriesFileHandling === 'function') {
        initializeTimeSeriesFileHandling([], null, [], {}); 
    }
    if (typeof initializeSpectroscopyFileHandling === 'function') {
        initializeSpectroscopyFileHandling([], {});
    }
    if (typeof sensorDataTables !== 'undefined') sensorDataTables = []; 
    if (typeof spectroscopyDataCollections !== 'undefined') spectroscopyDataCollections = [];


    if (dataFolderInput) dataFolderInput.value = null;

    if (document.getElementById('experiment-name')) document.getElementById('experiment-name').value = "MyExperiment";
    if (document.getElementById('target-gas-name')) document.getElementById('target-gas-name').value = "Target Gas";
    if (document.getElementById('gas-conc-cyl-2')) document.getElementById('gas-conc-cyl-2').value = "10";
    if (document.getElementById('ref-time')) document.getElementById('ref-time').value = "0:55:00.0";
    
    if (plotStartTimeInput) plotStartTimeInput.value = "";
    if (plotEndTimeInput) plotEndTimeInput.value = "";

    if (processingStatusStep1Div) { 
        processingStatusStep1Div.textContent = '';
        processingStatusStep1Div.className = '';
    }
    if (progressLogDiv) progressLogDiv.innerHTML = ''; 
    if (progressBar) {
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';
    }
    if (overallProgressStatusDiv) { 
         overallProgressStatusDiv.textContent = '';
         overallProgressStatusDiv.className = '';
    }
    if (gasConcProfileChartContainer) {
        gasConcProfileChartContainer.innerHTML = ''; 
        gasConcProfileChartContainer.style.display = 'none';
    }
    document.querySelectorAll('.charts-grid').forEach(grid => grid.innerHTML = ''); 
    document.querySelectorAll('.tab-content').forEach(tc => tc.style.display = 'none'); 
    tabsTimeSeriesDiv.style.display = 'none';
    tabsSpectroscopyDiv.style.display = 'none';
    plotRangeControlsTimeSeries.style.display = 'none';
    if (frequencySliceSelectorContainerImpedance) frequencySliceSelectorContainerImpedance.style.display = 'none';
    if (frequencySliceSelectorContainerPhase) frequencySliceSelectorContainerPhase.style.display = 'none';



    stepUploadConfigureDiv.style.display = 'block';
    stepProcessingProgressDiv.style.display = 'none';
    step3DisplayDiv.style.display = 'none';
    if(aboutInfoDiv) aboutInfoDiv.style.display = 'none'; 
    if(analysisTypeModal) analysisTypeModal.style.display = 'none';
    if(analyzeTimeSeriesBtn) analyzeTimeSeriesBtn.disabled = false; 
    if(analyzeSpectroscopyBtn) analyzeSpectroscopyBtn.disabled = false;


    if (processDataBtn) processDataBtn.disabled = true; 

    updateStep1Status('Please select data files and configure parameters to begin.', 'info');
    console.log("Application reset.");
}


function updateStep1Status(message, type = 'info') {
    if (processingStatusStep1Div) {
        processingStatusStep1Div.textContent = message;
        processingStatusStep1Div.className = ''; 
        processingStatusStep1Div.classList.add(`status-${type}`);
    } else {
        if (type === 'error') alert(message);
        else console.log(`${type.toUpperCase()}: ${message}`);
    }
}

function updateOverallProgressStatus(message, type = 'info') {
    if (overallProgressStatusDiv) {
        overallProgressStatusDiv.textContent = message;
        overallProgressStatusDiv.className = ''; 
        overallProgressStatusDiv.classList.add(`status-${type}`);
    }
}


function timeStringToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return NaN; 
    const parts = timeStr.split(':');
    let totalMinutes = 0;
    try {
        if (parts.length === 3) { 
            totalMinutes += parseInt(parts[0], 10) * 60; 
            totalMinutes += parseInt(parts[1], 10);      
            totalMinutes += parseFloat(parts[2]) / 60; 
        } else if (parts.length === 2) { 
            totalMinutes += parseInt(parts[0], 10);      
            totalMinutes += parseFloat(parts[1]) / 60; 
        } else {
            return NaN; 
        }
        return totalMinutes;
    } catch (e) {
        console.error("Error parsing time string:", timeStr, e);
        return NaN; 
    }
}

function parseCustomDateTime(dateTimeString) {
    if (!dateTimeString || typeof dateTimeString !== 'string') {
        console.warn("Invalid dateTimeString input to parseCustomDateTime:", dateTimeString);
        return null;
    }
    const parts = dateTimeString.trim().split(' ');
    if (parts.length !== 2) {
        console.warn("Invalid dateTimeString format (should have date and time separated by space):", dateTimeString);
        return null;
    }

    const dateParts = parts[0].split('/');
    if (dateParts.length !== 3) {
        console.warn("Invalid date part format (DD/MM/YYYY expected):", parts[0]);
        return null;
    }

    const timeParts = parts[1].split(':');
    if (timeParts.length < 2 || timeParts.length > 3) { 
        console.warn("Invalid time part format (HH:MM or HH:MM:SS or HH:MM:SS.s expected):", parts[1]);
        return null;
    }

    const day = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1; 
    const year = parseInt(dateParts[2], 10);

    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);
    
    let seconds = 0;
    let milliseconds = 0;

    if (timeParts[2]) { 
        const secAndMs = timeParts[2].split('.');
        seconds = parseInt(secAndMs[0], 10);
        if (secAndMs[1]) { 
            const msString = secAndMs[1].padEnd(3, '0').substring(0,3); 
            milliseconds = parseInt(msString, 10);
        }
    }

    if (isNaN(day) || isNaN(month) || isNaN(year) || isNaN(hours) || isNaN(minutes) || isNaN(seconds) || isNaN(milliseconds)) {
        console.warn("NaN encountered during parsing components of dateTimeString:", dateTimeString);
        return null;
    }
    return new Date(year, month, day, hours, minutes, seconds, milliseconds);
}


async function parseCsvFile(file, hasHeader = false) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader(); 

        reader.onload = (event) => { 
            try {
                const fileString = event.target.result; 
                let parsedData;

                if (typeof d3 === 'undefined') {
                    reject(new Error("D3.js library is not loaded."));
                    return;
                }

                if (hasHeader) {
                    parsedData = d3.csvParse(fileString, d3.autoType);
                } else {
                    parsedData = d3.dsvFormat(",").parseRows(fileString);
                }
                resolve(parsedData); 
            } catch (e) {
                reject(new Error(`Error parsing ${file.name} with D3.js: ${e.message}`));
            }
        };

        reader.onerror = (error) => { 
            reject(new Error(`Error reading file ${file.name}: ${error.message}`));
        };

        reader.readAsText(file); 
    });
}


async function parseGasFlowFile(file) {
    try {
        const parsedData = await parseCsvFile(file, false);
        gasFlowData = parsedData.map((row, index) => {
            if (!Array.isArray(row) || row.length < 3) {
                console.warn(`Gas flow file: Row ${index + 1} is invalid (expected at least 3 columns). Skipping.`);
                return null; 
            }
            const targetGasFlow = parseFloat(row[1]); 
            const durationSeconds = parseFloat(row[2]); 

            if (isNaN(targetGasFlow) || isNaN(durationSeconds)) {
                console.warn(`Gas flow file: Row ${index + 1} contains non-numeric data in required columns (cols 2 or 3 after parsing as strings). Skipping.`);
                return null; 
            }
            return {
                targetGasFlow: targetGasFlow,
                durationSeconds: durationSeconds
            };
        }).filter(r => r !== null); 

        if (gasFlowData.length === 0) {
            throw new Error("No valid data parsed from gas flow file. Check file format and content (should be numeric, with at least 3 columns per row).");
        }
        console.log("Parsed Gas Flow Data:", gasFlowData); 
    } catch (e) {
        throw new Error(`Failed to parse gas flow file (${file.name}): ${e.message}`);
    }
}

function calculateGasConcVsTime() {
    gasConcVsTime = []; 
    let currentTimeSeconds = 0;
    let currentConcentration = 0; 
    const totalFlowrate = config.totalFlowrate || 500; 

    gasConcVsTime.push({ time_min: 0, conc: currentConcentration }); 

    for (let i = 0; i < gasFlowData.length; i++) {
        const step = gasFlowData[i];
        if (totalFlowrate === 0) {
            console.warn("Total flowrate is 0, concentration calculation will be affected.");
            currentConcentration = (config.gasConcCyl2 > 0 && step.targetGasFlow > 0) ? Infinity : 0;
        } else {
            currentConcentration = (config.gasConcCyl2 * step.targetGasFlow) / totalFlowrate;
        }

        currentTimeSeconds += 0.05; 
        gasConcVsTime.push({ time_min: currentTimeSeconds / 60, conc: currentConcentration });

        currentTimeSeconds += step.durationSeconds;
        gasConcVsTime.push({ time_min: currentTimeSeconds / 60, conc: currentConcentration });
    }
    console.log("Calculated Gas Concentration vs. Time (minutes):", gasConcVsTime); 
}

function identifyGasExposureEvents(gasConcProfile) {
    const events = [];
    if (!gasConcProfile || gasConcProfile.length === 0) return events;

    let activeEvent = null;
    for (let i = 0; i < gasConcProfile.length; i++) {
        const point = gasConcProfile[i];

        if (point.conc > 0 && !activeEvent) {
            activeEvent = {
                startTime: point.time_min,
                concentration: point.conc,
                endTime: point.time_min 
            };
        } else if (activeEvent) {
            if (point.conc === activeEvent.concentration && point.time_min > activeEvent.endTime) { 
                activeEvent.endTime = point.time_min;
            } else if (point.conc !== activeEvent.concentration || point.time_min <= activeEvent.endTime) { 
                if (activeEvent.endTime > activeEvent.startTime) {
                    events.push({ ...activeEvent });
                }
                if (point.conc > 0) {
                    activeEvent = {
                        startTime: point.time_min,
                        concentration: point.conc,
                        endTime: point.time_min
                    };
                } else {
                    activeEvent = null; 
                }
            }
        }
    }
    if (activeEvent && activeEvent.endTime > activeEvent.startTime) {
        events.push({ ...activeEvent });
    }
    console.log("Identified Gas Exposure Events:", events);
    return events;
}


function plotGasConcentrationProfile(data, containerElement) {
    if (typeof Plotly === 'undefined') {
        containerElement.innerHTML = '<p style="text-align:center; padding:20px; color:red;">Plotly.js library not loaded. Cannot display chart.</p>';
        console.error("Plotly is not defined. Make sure the library is loaded.");
        return;
    }
    if (!data || data.length === 0) {
        if (!containerElement.textContent.includes("Gas flow table not found")) {
             containerElement.innerHTML = '<p style="text-align:center; padding:20px;">Gas concentration data not available or empty.</p>';
        }
        return;
    }
    containerElement.innerHTML = ''; 

    const trace = {
        x: data.map(p => p.time_min), 
        y: data.map(p => p.conc),     
        type: 'scatter',
        mode: 'lines+markers',        
        name: 'Calculated Concentration',
        line: { color: '#1f77b4' },   
        marker: { size: 4 }           
    };
    const layout = {
        title: { text: 'Calculated Gas Concentration Profile', font: {size: 16} },
        xaxis: { title: 'Time (min)' },
        yaxis: { title: config.gasConcentrationLabel }, 
        margin: { t: 50, l: 60, r: 30, b: 50 }, 
        height: 350, 
        autosize: true 
    };
    Plotly.newPlot(containerElement, [trace], layout, {responsive: true}); 
}

// --- Initial Page Setup ---
stepProcessingProgressDiv.style.display = 'none';
step3DisplayDiv.style.display = 'none';
if (processingStatusStep1Div) {
    processingStatusStep1Div.textContent = 'Please select data files and configure parameters to begin.';
    processingStatusStep1Div.className = 'status-info';
} else {
    console.log('Please select data files and configure parameters to begin.');
}
if (processDataBtn) processDataBtn.disabled = true; 
