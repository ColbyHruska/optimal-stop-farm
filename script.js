(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // SEEDED PRNG (mulberry32)
    // ═══════════════════════════════════════════════════════════════

    function createSeededRng(seed) {
        var s = Math.imul(seed, 0x9E3779B9) | 0;
        return function () {
            s = (s + 0x6D2B79F5) | 0;
            var t = Math.imul(s ^ (s >>> 15), s | 1);
            t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // CONSTANTS & STATE
    // ═══════════════════════════════════════════════════════════════

    var GRID_SIZE = 9;
    var MAX_AGE = 7;
    var WATER_SPEED_MS = 100;
    var WATER_CLEAR_MS = 300;
    var MAX_FARMS = 8;

    var FARM_COLORS = [
        '#4CAF50', '#ff9800', '#2196F3', '#e91e63',
        '#9c27b0', '#00bcd4', '#ff5722', '#607d8b'
    ];

    var STRATEGY_OPTIONS = [
        { value: 'threshold', label: 'Threshold' },
        { value: 'timed', label: 'Periodic' },
        { value: 'naive_heuristic', label: 'Crude Expected Value' },
        { value: 'smart_heuristic', label: 'Smarter Expected Value' },
        { value: 'fixed_time_lookahead', label: 'Fixed-Time Lookahead' },
    ];

    var state = {
        farms: [],
        totalTicks: 0,
        isPlaying: false,
        simulationInterval: null,
        currentSpeed: 50,
        nextFarmId: 0,
    };

    // ═══════════════════════════════════════════════════════════════
    // FARM OBJECT
    // ═══════════════════════════════════════════════════════════════

    function createFarmData(id) {
        var grid = [];
        for (var r = 0; r < GRID_SIZE; r++) {
            var row = [];
            for (var c = 0; c < GRID_SIZE; c++) row.push(0);
            grid.push(row);
        }
        return {
            id: id,
            grid: grid,
            totalYield: 0,
            harvestCount: 0,
            isHarvesting: false,
            rng: createSeededRng(0),
            history: [],
            strategy: id === 0 ? 'manual' : 'threshold',
            thresholdPct: 100,
            timedInterval: 800,
            ticksSinceHarvest: 0,
            dom: {},
        };
    }

    function resetFarmData(farm) {
        farm.totalYield = 0;
        farm.harvestCount = 0;
        farm.isHarvesting = false;
        farm.rng = createSeededRng(0);
        farm.history = [];
        farm.ticksSinceHarvest = 0;
        for (var r = 0; r < GRID_SIZE; r++) {
            for (var c = 0; c < GRID_SIZE; c++) {
                farm.grid[r][c] = 0;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // STRATEGIES
    // ═══════════════════════════════════════════════════════════════

    function countFullyGrown(grid) {
        var grown = 0;
        for (var r = 0; r < GRID_SIZE; r++) {
            for (var c = 0; c < GRID_SIZE; c++) {
                if (grid[r][c] === MAX_AGE) grown++;
            }
        }
        return grown;
    }

    var STRATEGIES = {
        manual: function () {
            return false;
        },

        threshold: function (grid, config) {
            var totalCrops = GRID_SIZE * GRID_SIZE;
            var grownCount = countFullyGrown(grid);
            var requiredCrops = Math.ceil((totalCrops * config.thresholdPct) / 100);
            return grownCount >= requiredCrops;
        },

        timed: function (grid, config) {
            return config.ticksSinceHarvest >= config.timedInterval;
        },

        naive_heuristic: function (grid) {
            var totalCrops = GRID_SIZE * GRID_SIZE;
            var grownCount = countFullyGrown(grid);
            var remaining = totalCrops - grownCount;
            if (remaining === 0) return true;
            var expectedTicksForNextGrowth = totalCrops / remaining;
            return expectedTicksForNextGrowth > MAX_AGE;
        },

        smart_heuristic: function (grid) {
            var totalCrops = GRID_SIZE * GRID_SIZE;
            var grownCount = countFullyGrown(grid);
            if (grownCount === 0) return false;
            if (grownCount === totalCrops) return true;

            var ageCounts = new Array(MAX_AGE + 1).fill(0);
            for (var r = 0; r < GRID_SIZE; r++) {
                for (var c = 0; c < GRID_SIZE; c++) {
                    ageCounts[grid[r][c]]++;
                }
            }

            var remainingHits = 0;
            for (var age = 0; age < MAX_AGE; age++) {
                remainingHits += ageCounts[age] * (MAX_AGE - age);
            }

            var remaining = totalCrops - grownCount;
            var avgCostPerHit = totalCrops / remaining;
            var expectedTicks = remainingHits * avgCostPerHit;
            var marginalCostPerCrop = expectedTicks / remaining;

            return marginalCostPerCrop > MAX_AGE;
        },

        fixed_time_lookahead: function (grid) {
            var totalCrops = GRID_SIZE * GRID_SIZE;
            var N = totalCrops;
            var M = MAX_AGE;

            if (!STRATEGIES.dpCache) {
                var MAX_K = 2000;
                var P = [];
                for (var k = 0; k <= MAX_K; k++) {
                    P.push(new Float64Array(M + 1));
                }
                P[0][0] = 1.0;
                for (var k = 1; k <= MAX_K; k++) {
                    P[k][0] = P[k - 1][0] * (1 - 1 / N);
                    for (var h = 1; h < M; h++) {
                        P[k][h] = P[k - 1][h] * (1 - 1 / N) + P[k - 1][h - 1] * (1 / N);
                    }
                    P[k][M] = P[k - 1][M] + P[k - 1][M - 1] * (1 / N);
                }

                var maxRate = 0;
                for (var k = 1; k <= MAX_K; k++) {
                    var expectedYield = N * P[k][M];
                    var rate = expectedYield / k;
                    if (rate > maxRate) maxRate = rate;
                }

                STRATEGIES.dpCache = P;
                STRATEGIES.lambdaStar = maxRate;
                STRATEGIES.MAX_K = MAX_K;
            }

            var currentYield = countFullyGrown(grid);
            if (currentYield === N) return true;
            if (currentYield === 0) return false;

            var ageCounts = new Array(M + 1).fill(0);
            for (var r = 0; r < GRID_SIZE; r++) {
                for (var c = 0; c < GRID_SIZE; c++) {
                    ageCounts[grid[r][c]]++;
                }
            }

            var maxExpectedSurplus = 0;
            for (var k = 1; k <= STRATEGIES.MAX_K; k++) {
                var expectedYield = 0;
                for (var age = 0; age <= M; age++) {
                    if (ageCounts[age] === 0) continue;
                    var rem = M - age;
                    if (rem === 0) {
                        expectedYield += ageCounts[age];
                        continue;
                    }
                    var probReachingM = 0;
                    for (var h = rem; h <= M; h++) {
                        probReachingM += STRATEGIES.dpCache[k][h];
                    }
                    expectedYield += ageCounts[age] * probReachingM;
                }
                var surplus = expectedYield - STRATEGIES.lambdaStar * k;
                if (surplus > maxExpectedSurplus) maxExpectedSurplus = surplus;
            }

            return currentYield >= maxExpectedSurplus;
        },
    };

    function evaluateStrategy(grid, strategyName, config) {
        var fn = STRATEGIES[strategyName];
        if (!fn) return false;
        return fn(grid, config);
    }

    // ═══════════════════════════════════════════════════════════════
    // GRID VISUALS
    // ═══════════════════════════════════════════════════════════════

    function setCellClass(cell, cls) {
        if (cell.dataset.stage === cls) return;
        var old = cell.dataset.stage;
        if (old) cell.classList.remove(old);
        cell.classList.add(cls);
        cell.dataset.stage = cls;
    }

    function updateCellVisual(farm, r, c) {
        var age = farm.grid[r][c];
        var cell = farm.dom.cells[r * GRID_SIZE + c];
        if (cell) setCellClass(cell, 'stage-' + age);
    }

    function resetFarmVisuals(farm) {
        for (var r = 0; r < GRID_SIZE; r++) {
            for (var c = 0; c < GRID_SIZE; c++) {
                updateCellVisual(farm, r, c);
            }
        }
    }

    function buildGridCells(farm) {
        var gridEl = farm.dom.gridEl;
        gridEl.style.gridTemplateColumns = 'repeat(' + GRID_SIZE + ', 1fr)';
        gridEl.style.gridTemplateRows = 'repeat(' + GRID_SIZE + ', 1fr)';
        gridEl.innerHTML = '';
        farm.dom.cells = [];
        for (var r = 0; r < GRID_SIZE; r++) {
            for (var c = 0; c < GRID_SIZE; c++) {
                var cell = document.createElement('div');
                cell.classList.add('crop-cell');
                gridEl.appendChild(cell);
                farm.dom.cells.push(cell);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // GROWTH & HARVEST
    // ═══════════════════════════════════════════════════════════════

    function stepGrowth(farm) {
        var r = Math.floor(farm.rng() * GRID_SIZE);
        var c = Math.floor(farm.rng() * GRID_SIZE);
        if (farm.grid[r][c] < MAX_AGE) {
            farm.grid[r][c]++;
            if (!farm.isHarvesting) {
                updateCellVisual(farm, r, c);
            }
            return true;
        }
        return false;
    }

    function doHarvest(farm) {
        if (farm.isHarvesting) return;

        var grownCount = countFullyGrown(farm.grid);
        farm.totalYield += grownCount;
        farm.isHarvesting = true;
        farm.harvestCount++;
        farm.ticksSinceHarvest = 0;
        farm.rng = createSeededRng(farm.harvestCount);

        for (var r = 0; r < GRID_SIZE; r++) {
            for (var c = 0; c < GRID_SIZE; c++) {
                farm.grid[r][c] = 0;
            }
        }

        // Water animation
        var row = 0;
        function animateWaterRow() {
            if (!farm.isHarvesting) return;
            if (row < GRID_SIZE) {
                for (var c = 0; c < GRID_SIZE; c++) {
                    var cell = farm.dom.cells[row * GRID_SIZE + c];
                    if (cell) setCellClass(cell, 'water');
                }
                row++;
                setTimeout(animateWaterRow, WATER_SPEED_MS);
            } else {
                setTimeout(function () {
                    if (!farm.isHarvesting) return;
                    resetFarmVisuals(farm);
                    farm.isHarvesting = false;
                }, WATER_CLEAR_MS);
            }
        }
        animateWaterRow();
    }

    // ═══════════════════════════════════════════════════════════════
    // CHART
    // ═══════════════════════════════════════════════════════════════

    var CHART_PADDING = { top: 30, right: 20, bottom: 40, left: 55 };
    var GRID_COLOR = 'rgba(255, 255, 255, 0.07)';
    var AXIS_COLOR = 'rgba(255, 255, 255, 0.3)';
    var LABEL_COLOR = 'rgba(255, 255, 255, 0.6)';
    var TITLE_COLOR = 'rgba(255, 255, 255, 0.8)';
    var MAX_RENDER_POINTS = 600;

    var chartCanvas = null;
    var chartCtx = null;
    var renderScheduled = false;
    var chartDisplayWidth = 0;
    var chartDisplayHeight = 0;

    function initChart(canvasEl) {
        chartCanvas = canvasEl;
        chartCtx = chartCanvas.getContext('2d');
        resizeCanvas();
    }

    function resizeCanvas() {
        if (!chartCanvas) return;
        var rect = chartCanvas.getBoundingClientRect();
        chartDisplayWidth = rect.width;
        chartDisplayHeight = rect.height;
        var dpr = window.devicePixelRatio || 1;
        chartCanvas.width = rect.width * dpr;
        chartCanvas.height = rect.height * dpr;
        chartCtx.scale(dpr, dpr);
    }

    function scheduleChartRender() {
        if (renderScheduled) return;
        renderScheduled = true;
        requestAnimationFrame(function () {
            renderScheduled = false;
            renderChart();
        });
    }

    function downsample(data, maxPoints) {
        if (data.length <= maxPoints) return data;
        var step = data.length / maxPoints;
        var result = [data[0]];
        for (var i = 1; i < maxPoints - 1; i++) {
            result.push(data[Math.round(i * step)]);
        }
        result.push(data[data.length - 1]);
        return result;
    }

    function renderChart() {
        if (!chartCtx || !chartCanvas) return;
        var displayWidth = chartDisplayWidth;
        var displayHeight = chartDisplayHeight;
        chartCtx.clearRect(0, 0, displayWidth, displayHeight);

        var chartWidth = displayWidth - CHART_PADDING.left - CHART_PADDING.right;
        var chartHeight = displayHeight - CHART_PADDING.top - CHART_PADDING.bottom;
        if (chartWidth <= 0 || chartHeight <= 0) return;

        // Gather all data points
        var allData = [];
        for (var f = 0; f < state.farms.length; f++) {
            allData = allData.concat(state.farms[f].history);
        }

        if (allData.length === 0) {
            chartCtx.fillStyle = LABEL_COLOR;
            chartCtx.font = '16px "VT323", monospace';
            chartCtx.textAlign = 'center';
            chartCtx.fillText('No data yet \u2014 start the simulation!', displayWidth / 2, displayHeight / 2);
            return;
        }

        var maxTick = 1, maxTotal = 1;
        for (var i = 0; i < allData.length; i++) {
            if (allData[i].tick > maxTick) maxTick = allData[i].tick;
            if (allData[i].total > maxTotal) maxTotal = allData[i].total;
        }
        var yMax = maxTotal * 1.1;

        drawGridLines(chartWidth, chartHeight, maxTick, yMax);
        drawAxes(chartWidth, chartHeight, maxTick, yMax);

        for (var f = 0; f < state.farms.length; f++) {
            var farm = state.farms[f];
            if (farm.history.length > 0) {
                var color = FARM_COLORS[farm.id % FARM_COLORS.length];
                drawLine(downsample(farm.history, MAX_RENDER_POINTS), chartWidth, chartHeight, maxTick, yMax, color);
            }
        }

        if (state.farms.length > 1) drawLegend(displayWidth);

        chartCtx.fillStyle = TITLE_COLOR;
        chartCtx.font = '14px "VT323", monospace';
        chartCtx.textAlign = 'center';
        chartCtx.fillText('Total Crops (Harvested + Grown) Over Time', displayWidth / 2, 16);
    }

    function drawGridLines(cw, ch, maxTick, yMax) {
        chartCtx.strokeStyle = GRID_COLOR;
        chartCtx.lineWidth = 1;
        for (var i = 0; i <= 5; i++) {
            var y = CHART_PADDING.top + (ch * i) / 5;
            chartCtx.beginPath(); chartCtx.moveTo(CHART_PADDING.left, y); chartCtx.lineTo(CHART_PADDING.left + cw, y); chartCtx.stroke();
        }
        var xSteps = Math.min(Math.ceil(maxTick / 100), 10) || 1;
        for (var j = 0; j <= xSteps; j++) {
            var x = CHART_PADDING.left + (cw * j) / xSteps;
            chartCtx.beginPath(); chartCtx.moveTo(x, CHART_PADDING.top); chartCtx.lineTo(x, CHART_PADDING.top + ch); chartCtx.stroke();
        }
    }

    function drawAxes(cw, ch, maxTick, yMax) {
        chartCtx.strokeStyle = AXIS_COLOR;
        chartCtx.lineWidth = 1.5;
        chartCtx.beginPath(); chartCtx.moveTo(CHART_PADDING.left, CHART_PADDING.top); chartCtx.lineTo(CHART_PADDING.left, CHART_PADDING.top + ch); chartCtx.stroke();
        chartCtx.beginPath(); chartCtx.moveTo(CHART_PADDING.left, CHART_PADDING.top + ch); chartCtx.lineTo(CHART_PADDING.left + cw, CHART_PADDING.top + ch); chartCtx.stroke();

        chartCtx.fillStyle = LABEL_COLOR;
        chartCtx.font = '12px "VT323", monospace';
        chartCtx.textAlign = 'right';
        for (var i = 0; i <= 5; i++) {
            var value = yMax * (1 - i / 5);
            var y = CHART_PADDING.top + (ch * i) / 5;
            chartCtx.fillText(Math.round(value).toString(), CHART_PADDING.left - 6, y + 4);
        }

        chartCtx.textAlign = 'center';
        var xSteps = Math.min(Math.ceil(maxTick / 100), 10) || 1;
        for (var j = 0; j <= xSteps; j++) {
            var val = Math.round((maxTick * j) / xSteps);
            var x = CHART_PADDING.left + (cw * j) / xSteps;
            chartCtx.fillText(val.toString(), x, CHART_PADDING.top + ch + 18);
        }

        chartCtx.fillStyle = LABEL_COLOR;
        chartCtx.font = '13px "VT323", monospace';
        chartCtx.textAlign = 'center';
        chartCtx.fillText('Ticks', CHART_PADDING.left + cw / 2, CHART_PADDING.top + ch + 34);
        chartCtx.save();
        chartCtx.translate(14, CHART_PADDING.top + ch / 2);
        chartCtx.rotate(-Math.PI / 2);
        chartCtx.fillText('Total Crops', 0, 0);
        chartCtx.restore();
    }

    function drawLine(data, cw, ch, maxTick, yMax, color) {
        if (data.length === 0) return;
        chartCtx.strokeStyle = color;
        chartCtx.lineWidth = 1.5;
        chartCtx.lineJoin = 'round';
        chartCtx.lineCap = 'round';
        chartCtx.beginPath();
        for (var i = 0; i < data.length; i++) {
            var x = CHART_PADDING.left + (data[i].tick / maxTick) * cw;
            var y = CHART_PADDING.top + ch - (data[i].total / yMax) * ch;
            if (i === 0) chartCtx.moveTo(x, y);
            else chartCtx.lineTo(x, y);
        }
        chartCtx.stroke();
    }

    function drawLegend(displayWidth) {
        chartCtx.font = '13px "VT323", monospace';
        var legendY = CHART_PADDING.top + 4;
        var xPos = displayWidth - 20;

        for (var i = state.farms.length - 1; i >= 0; i--) {
            var farm = state.farms[i];
            var color = FARM_COLORS[farm.id % FARM_COLORS.length];
            var label = 'Farm ' + (farm.id + 1);
            var textWidth = chartCtx.measureText(label).width;

            xPos -= textWidth;
            chartCtx.fillStyle = LABEL_COLOR;
            chartCtx.textAlign = 'left';
            chartCtx.fillText(label, xPos, legendY + 3);

            xPos -= 14;
            chartCtx.fillStyle = color;
            chartCtx.fillRect(xPos, legendY - 6, 10, 10);

            xPos -= 12;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // DYNAMIC FARM DOM
    // ═══════════════════════════════════════════════════════════════

    function buildFarmCard(farm) {
        var card = document.createElement('div');
        card.className = 'farm-card';
        card.dataset.farmId = farm.id;

        // Title
        var title = document.createElement('h2');
        title.className = 'farm-title';
        title.textContent = 'Farm ' + (farm.id + 1);
        var color = FARM_COLORS[farm.id % FARM_COLORS.length];
        title.style.color = color;
        card.appendChild(title);

        // Body (grid + stats sidebar)
        var body = document.createElement('div');
        body.className = 'farm-body';

        // Grid column
        var farmCol = document.createElement('div');
        farmCol.className = 'farm-column';
        var gridEl = document.createElement('div');
        gridEl.className = 'farm-grid';
        farmCol.appendChild(gridEl);

        // Harvest button (only for first farm)
        var harvestBtn = document.createElement('button');
        harvestBtn.className = 'btn harvest-btn harvest-btn--farm';
        harvestBtn.textContent = 'Harvest Now';
        if (farm.id !== 0 || farm.strategy !== 'manual') {
            harvestBtn.classList.add('hidden');
        }
        harvestBtn.addEventListener('click', function () {
            if (!farm.isHarvesting) doHarvest(farm);
        });
        farmCol.appendChild(harvestBtn);

        body.appendChild(farmCol);

        // Stats sidebar
        var stats = document.createElement('div');
        stats.className = 'farm-stats';

        // Strategy selector
        var stratGroup = document.createElement('div');
        stratGroup.className = 'farm-strategy-group';
        var stratLabel = document.createElement('label');
        stratLabel.textContent = 'Strategy';
        stratGroup.appendChild(stratLabel);

        var stratSelect = document.createElement('select');
        // Only farm 0 gets manual option
        if (farm.id === 0) {
            var manualOpt = document.createElement('option');
            manualOpt.value = 'manual';
            manualOpt.textContent = 'Manual';
            stratSelect.appendChild(manualOpt);
        }
        for (var i = 0; i < STRATEGY_OPTIONS.length; i++) {
            var opt = document.createElement('option');
            opt.value = STRATEGY_OPTIONS[i].value;
            opt.textContent = STRATEGY_OPTIONS[i].label;
            stratSelect.appendChild(opt);
        }
        stratSelect.value = farm.strategy;
        stratGroup.appendChild(stratSelect);

        // Threshold sub-group
        var threshGroup = document.createElement('div');
        threshGroup.className = 'farm-threshold-group';
        if (farm.strategy !== 'threshold') threshGroup.classList.add('hidden');
        var threshLabel = document.createElement('label');
        var threshLabelSpan = document.createElement('span');
        threshLabelSpan.textContent = farm.thresholdPct;
        threshLabel.textContent = 'Harvest at: ';
        threshLabel.appendChild(threshLabelSpan);
        threshLabel.appendChild(document.createTextNode('%'));
        threshGroup.appendChild(threshLabel);

        var threshSlider = document.createElement('input');
        threshSlider.type = 'range';
        threshSlider.min = '1';
        threshSlider.max = '100';
        threshSlider.value = farm.thresholdPct;
        threshGroup.appendChild(threshSlider);

        stratGroup.appendChild(threshGroup);

        // Timed sub-group
        var timedGroup = document.createElement('div');
        timedGroup.className = 'farm-timed-group';
        if (farm.strategy !== 'timed') timedGroup.classList.add('hidden');
        var timedLabel = document.createElement('label');
        timedLabel.textContent = 'Period (ticks):';
        timedGroup.appendChild(timedLabel);

        var timedInput = document.createElement('input');
        timedInput.type = 'number';
        timedInput.className = 'timed-input';
        timedInput.min = '1';
        timedInput.value = farm.timedInterval;
        timedGroup.appendChild(timedInput);

        stratGroup.appendChild(timedGroup);
        stats.appendChild(stratGroup);

        // Yield stat
        var yieldBox = document.createElement('div');
        yieldBox.className = 'stat-box stat-column';
        var yieldLabel = document.createElement('span');
        yieldLabel.className = 'stat-label stat-label--inline';
        yieldLabel.textContent = 'Total Yield';
        var yieldVal = document.createElement('span');
        yieldVal.className = 'stat-value stat-value--large';
        yieldVal.textContent = '0';
        yieldBox.appendChild(yieldLabel);
        yieldBox.appendChild(yieldVal);
        stats.appendChild(yieldBox);

        // Harvests stat
        var harvestBox = document.createElement('div');
        harvestBox.className = 'stat-box stat-column stat-divider-top';
        var harvestLabel = document.createElement('span');
        harvestLabel.className = 'stat-label stat-label--subtle';
        harvestLabel.textContent = 'Harvests';
        var harvestVal = document.createElement('span');
        harvestVal.className = 'stat-value';
        harvestVal.textContent = '0';
        harvestBox.appendChild(harvestLabel);
        harvestBox.appendChild(harvestVal);
        stats.appendChild(harvestBox);

        // Yield/Time stat
        var ytBox = document.createElement('div');
        ytBox.className = 'stat-box stat-column highlight stat-divider-top';
        var ytLabel = document.createElement('span');
        ytLabel.className = 'stat-label stat-label--subtle';
        ytLabel.textContent = 'Yield / Time';
        var ytVal = document.createElement('span');
        ytVal.className = 'stat-value';
        ytVal.textContent = '0.0000';
        ytBox.appendChild(ytLabel);
        ytBox.appendChild(ytVal);
        stats.appendChild(ytBox);

        body.appendChild(stats);
        card.appendChild(body);

        // Store DOM refs
        farm.dom = {
            card: card,
            gridEl: gridEl,
            cells: [],
            harvestBtn: harvestBtn,
            stratSelect: stratSelect,
            threshGroup: threshGroup,
            threshSlider: threshSlider,
            threshLabelSpan: threshLabelSpan,
            timedGroup: timedGroup,
            timedInput: timedInput,
            yieldVal: yieldVal,
            harvestVal: harvestVal,
            ytVal: ytVal,
        };

        // Strategy change handler
        stratSelect.addEventListener('change', function () {
            farm.strategy = stratSelect.value;
            farm.thresholdPct = parseInt(threshSlider.value);
            farm.timedInterval = parseInt(timedInput.value) || 800;
            threshGroup.classList.toggle('hidden', farm.strategy !== 'threshold');
            timedGroup.classList.toggle('hidden', farm.strategy !== 'timed');
            // Only farm 0 can show harvest button
            if (farm.id === 0) {
                harvestBtn.classList.toggle('hidden', farm.strategy !== 'manual');
            }
        });

        // Threshold slider handler
        threshSlider.addEventListener('input', function () {
            farm.thresholdPct = parseInt(threshSlider.value);
            threshLabelSpan.textContent = threshSlider.value;
        });

        // Timed input handler
        timedInput.addEventListener('input', function () {
            var val = parseInt(timedInput.value);
            if (val && val > 0) farm.timedInterval = val;
        });

        return card;
    }

    // ═══════════════════════════════════════════════════════════════
    // MAIN
    // ═══════════════════════════════════════════════════════════════

    var dom = {};

    function init() {
        dom = {
            farmsContainer: document.getElementById('farms-container'),
            statTicks: document.getElementById('stat-ticks'),
            speedSlider: document.getElementById('speed-slider'),
            speedLabel: document.getElementById('speed-label'),
            btnPlayPause: document.getElementById('btn-play-pause'),
            btnStep: document.getElementById('btn-step'),
            btnReset: document.getElementById('btn-reset'),
            btnAddFarm: document.getElementById('btn-add-farm'),
            btnRemoveFarm: document.getElementById('btn-remove-farm'),
            farmCountLabel: document.getElementById('farm-count-label'),
            chartCanvas: document.getElementById('chart-canvas'),
        };

        initChart(dom.chartCanvas);
        addFarm(); // Start with 1 farm
        setupEventListeners();
        updateUI();
    }

    function addFarm() {
        if (state.farms.length >= MAX_FARMS) return;

        var farm = createFarmData(state.nextFarmId++);
        state.farms.push(farm);

        var card = buildFarmCard(farm);
        dom.farmsContainer.appendChild(card);
        buildGridCells(farm);
        resetFarmVisuals(farm);

        dom.farmCountLabel.textContent = state.farms.length;
        dom.btnRemoveFarm.disabled = state.farms.length <= 1;
        dom.btnAddFarm.disabled = state.farms.length >= MAX_FARMS;
    }

    function removeFarm() {
        if (state.farms.length <= 1) return;

        var farm = state.farms.pop();
        farm.dom.card.remove();

        dom.farmCountLabel.textContent = state.farms.length;
        dom.btnRemoveFarm.disabled = state.farms.length <= 1;
        dom.btnAddFarm.disabled = state.farms.length >= MAX_FARMS;
    }

    function resetSimulation() {
        pauseSimulation();
        state.totalTicks = 0;
        for (var i = 0; i < state.farms.length; i++) {
            resetFarmData(state.farms[i]);
            resetFarmVisuals(state.farms[i]);
        }
        updateUI();
        renderChart();
    }

    function updateUI() {
        dom.statTicks.textContent = state.totalTicks.toLocaleString();
        for (var i = 0; i < state.farms.length; i++) {
            var farm = state.farms[i];
            farm.dom.yieldVal.textContent = farm.totalYield.toLocaleString();
            farm.dom.harvestVal.textContent = farm.harvestCount;
            var yt = state.totalTicks > 0 ? (farm.totalYield / state.totalTicks) : 0;
            farm.dom.ytVal.textContent = yt.toFixed(4);
        }
    }

    function recordSnapshot() {
        for (var i = 0; i < state.farms.length; i++) {
            var farm = state.farms[i];
            farm.history.push({
                tick: state.totalTicks,
                total: farm.totalYield + countFullyGrown(farm.grid),
            });
        }
    }

    function stepSimulation() {
        state.totalTicks++;
        for (var i = 0; i < state.farms.length; i++) {
            var farm = state.farms[i];
            farm.ticksSinceHarvest++;
            stepGrowth(farm);
            if (!farm.isHarvesting && evaluateStrategy(farm.grid, farm.strategy, { thresholdPct: farm.thresholdPct, timedInterval: farm.timedInterval, ticksSinceHarvest: farm.ticksSinceHarvest })) {
                doHarvest(farm);
            }
        }
        recordSnapshot();
        scheduleChartRender();
        updateUI();
    }

    function setSimulationSpeed() {
        var maxInterval = 500;
        var minInterval = 10;
        var interval = maxInterval - ((state.currentSpeed - 1) / 99) * (maxInterval - minInterval);
        if (state.isPlaying) {
            clearInterval(state.simulationInterval);
            state.simulationInterval = setInterval(stepSimulation, interval);
        }
    }

    function togglePlayPause() {
        state.isPlaying = !state.isPlaying;
        if (state.isPlaying) {
            dom.btnPlayPause.innerText = 'Pause';
            dom.btnPlayPause.classList.remove('primary-btn');
            dom.btnPlayPause.classList.add('pause-btn');
            setSimulationSpeed();
        } else {
            pauseSimulation();
        }
    }

    function pauseSimulation() {
        state.isPlaying = false;
        dom.btnPlayPause.innerText = 'Play';
        dom.btnPlayPause.classList.add('primary-btn');
        dom.btnPlayPause.classList.remove('pause-btn');
        clearInterval(state.simulationInterval);
    }

    function setupEventListeners() {
        dom.btnPlayPause.addEventListener('click', togglePlayPause);
        dom.btnStep.addEventListener('click', function () { pauseSimulation(); stepSimulation(); });
        dom.btnReset.addEventListener('click', resetSimulation);
        dom.btnAddFarm.addEventListener('click', function () { addFarm(); resetSimulation(); });
        dom.btnRemoveFarm.addEventListener('click', function () { removeFarm(); resetSimulation(); });

        dom.speedSlider.addEventListener('input', function (e) {
            state.currentSpeed = parseInt(e.target.value);
            if (state.currentSpeed < 30) dom.speedLabel.innerText = 'Slow';
            else if (state.currentSpeed < 70) dom.speedLabel.innerText = 'Medium';
            else dom.speedLabel.innerText = 'Fast';
            setSimulationSpeed();
        });

        window.addEventListener('resize', function () {
            resizeCanvas();
            renderChart();
        });
    }

    window.addEventListener('DOMContentLoaded', init);
})();
