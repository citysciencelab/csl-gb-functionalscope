import Amenities from "@/config/amenities.json";
import Bridges from "@/config/bridges.json";
import NoiseLayer from "@/config/noise.json";
import WindResult from "@/config/windResult.json";
import SunExposure from "@/config/sunExposureResult.json";
import SolarRadiation from "@/config/solarRadiationResult.json";
import TrafficCountLayer from "@/config/trafficCounts.json";
import {abmTripsLayerName, animate, buildTripsLayer, abmAggregationLayerName, buildAggregationLayer, buildArcLayer, abmArcLayerName} from "@/store/deck-layers";
import {bridges as bridgeNames, bridgeVeddelOptions} from "@/store/abm";
import {getFormattedTrafficCounts, noiseLayerName} from "@/store/noise";
import { mdiControllerClassicOutline } from '@mdi/js';
import { VCarouselReverseTransition } from 'vuetify/lib';

import {calculateAbmStatsForFocusArea} from "@/store/scenario/abmStats";
import {calculateAmenityStatsForFocusArea} from "@/store/scenario/amenityStats";
import MultiLayerAnalysisConfig from "@/config/multiLayerAnalysis.json";
import SubSelectionLayerConfig from "@/config/layerSubSelection.json";
import PerformanceInfosConfig from "@/config/performanceInfos.json";
import {ActionContext} from "vuex";
import FocusAreasLayer from "@/config/focusAreas.json";

export default {
  updateNoiseScenario({state, commit, dispatch, rootState}) {
    // check if traffic counts already in store, otherwise load them from cityPyo
    if (!state.trafficCounts) {
      rootState.cityPyO.getLayer("trafficCounts", false).then(
        trafficData => {
          commit('trafficCounts', trafficData)
        })
    }
    // check if the requested noise result is already in store
    if (state.noiseResults.length > 0) {
      const noiseResult = state.noiseResults.filter(d => isNoiseScenarioMatching(d, state.noiseScenario))[0]
      const geoJsonData = noiseResult['geojson_result']
      commit('currentNoiseGeoJson', Object.freeze(geoJsonData))
      dispatch('addNoiseMapLayer', geoJsonData)
        .then(
          dispatch('addTrafficCountLayer')
      )
    } else {
      // load noise data from cityPyo and add it to the store
      // gets one file containing all noise scenario result
      commit('resultLoading', true)
      rootState.cityPyO.getLayer("noiseScenarios", false).then(
        noiseData => {
          commit('noiseResults', Object.freeze(noiseData["noise_results"]))
          // select matching result for current scenario and add it to the map
          const noiseResult = noiseData["noise_results"].filter(d => isNoiseScenarioMatching(d, state.noiseScenario))[0]
          const geoJsonData =  noiseResult['geojson_result']
          commit('currentNoiseGeoJson', Object.freeze(geoJsonData))
          dispatch('addNoiseMapLayer', geoJsonData)
            .then(
              dispatch('addTrafficCountLayer'),
              commit('resultLoading', false)
          )
      })
    }
  },
  addNoiseMapLayer({state, commit, dispatch, rootState}, geoJsonData) {
    const source = {
      id: NoiseLayer.mapSource.data.id,
      options: {
        type: 'geojson',
        data: geoJsonData
      }
    }
    dispatch('addSourceToMap', source, {root: true})
      .then(source => {
        dispatch('addLayerToMap', NoiseLayer.layer, {root: true})
      }).then(source => {
    })
  },
  addTrafficCountLayer({state, commit, dispatch, rootState}) {
      //const scenarioTraffic = getFormattedTrafficCounts(state.trafficCountPoints, state.noiseScenario.traffic_percent)
      const scenarioTraffic = JSON.parse(JSON.stringify(state.trafficCounts))
      const trafficPercent = state.noiseScenario.traffic_percent
      scenarioTraffic["features"].forEach(point => {
        const carTrafficDaily = Math.floor(point["properties"]["car_traffic_daily"] * trafficPercent)
        const truckTrafficDaily = Math.floor(point["properties"]["truck_traffic_daily"] * trafficPercent)
        point["properties"]["car_traffic_daily"] = carTrafficDaily
        point["properties"]["truck_traffic_daily"] = truckTrafficDaily
        point["properties"]["description"] = "Cars: " + carTrafficDaily + " Trucks: " + truckTrafficDaily
      });

    const source = {
      id: TrafficCountLayer.mapSource.data.id,
      options: {
        type: 'geojson',
        data: scenarioTraffic
      }
    }
      dispatch('addSourceToMap', source, {root: true})
        .then(source => {
          dispatch('addLayerToMap', TrafficCountLayer.layer, {root: true})
        })
  },
  addSolarRadiationLayer({state, rootState, commit, dispatch}: ActionContext<StoreState, StoreState>){
    rootState.cityPyO.getLayer("solar_radiation").then(source => {
        commit('solarRadiationGeoJson', source.options.data)
        dispatch('addSourceToMap', source, {root: true})
          .then(source => {
            dispatch('addLayerToMap', SolarRadiation.layer, {root: true})
          })
      }
    )
  },
  addSunExposureLayer({state, rootState, commit, dispatch}: ActionContext<StoreState, StoreState>){
    rootState.cityPyO.getLayer("sun_exposure").then(source => {
        commit('sunExposureGeoJson', source.options.data)
        dispatch('addSourceToMap', source, {root: true})
          .then(source => {
            dispatch('addLayerToMap', SunExposure.layer, {root: true})
          })
      }
    )
  },
  // load layer source from cityPyo and add the layer to the map
  // Todo : isnt there a way to update the source data without reinstanciating the entire layer?
  async updateWindLayer({state, commit, dispatch, rootState}) {

    // fetch results, add to map and return boolean whether results are complete or not
    const completed = await rootState.cityPyO.getSimulationResultForScenario("wind", state.windScenarioHash).then(
      resultInfo => {
        const receivedCompleteResult = resultInfo.complete || false  // was the result complete?
        const source = resultInfo.source

        // results are new if they contain more features than the known result
        const newResults = !state.windResultGeoJson
          || (source.options.data.features.length > state.windResultGeoJson["features"].length)

        if (receivedCompleteResult || newResults) {   // todo use timestamP??
          // received an updated result
          source.id = "wind"
          commit('windResultGeoJson', Object.freeze(source.options.data))
          dispatch('addSourceToMap', source, {root: true})
            .then(source => {
              dispatch('addLayerToMap', WindResult.layer, {root: true})
            })
        }
        return receivedCompleteResult
    })

    if (!completed) {
      // keep fetching new results until the results are complete
      await new Promise(resolve => setTimeout(resolve, 3000));
      dispatch("updateWindLayer")
      }
  },
  loadWorkshopScenario({state, commit, dispatch, rootState}, scenarioId) {
    let bridges = updateBridges(
      bridgeNames.bridge_hafencity,
      bridgeVeddelOptions.diagonal,
    )

    commit('bridges', bridges)
    dispatch('updateBridgeLayer')
    dispatch('initialAbmComputing', scenarioId)
    dispatch('updateAmenitiesLayer', scenarioId)
  },
  updateAbmDesignScenario({state, commit, dispatch, rootState}) {
    // update scenario name

    let bridges = updateBridges(
      state.moduleSettings.bridge_hafencity,
      state.moduleSettings.bridge_veddel
    )

    commit('bridges', bridges)
    dispatch('updateBridgeLayer')

    // reset abmStats
    if (JSON.stringify(state.abmStats) !== JSON.stringify({})) {
      commit("abmStats", {}) // reset abmStats
      commit("amenityStats", {}) // reset amenityStats
    }
    dispatch('initialAbmComputing')

    //dispatch('updateDeckLayer')
    dispatch('updateAmenitiesLayer')
  },
  calculateStats({state, commit, dispatch, rootState}) {
    calculateAmenityStatsForFocusArea()
    calculateAbmStatsForFocusArea()
  },
  // load layer source from cityPyo and add the layer to the map
  updateAmenitiesLayer({state, commit, dispatch, rootState}, workshopId) {
    // load new data from cityPyo
    let amenitiesLayerName = workshopId || Amenities.mapSource.data.id

    rootState.cityPyO.getAbmAmenitiesLayer(amenitiesLayerName, state).then(
      source => {
        console.log("got amenities", source)
        commit('amenitiesGeoJson', Object.freeze(source.options.data))
        dispatch('addSourceToMap', source, {root: true})
          .then(source => {
            dispatch('addLayerToMap', Amenities.layer, {root: true})
          })
      })
  },
  // load layer source from cityPyo and add the layer to the map
  updateBridgeLayer({state, commit, dispatch, rootState}, payload) {
    // delete any bridge layer that is still on the map, before adding a new one

    // TODO this part can be deleted?? is already moved when calling "addSourceToMap"
    Bridges.layers.forEach(layer => {
      if (rootState.map?.getSource(layer.source)) {
        dispatch("removeSourceFromMap", layer.source, { root: true })
      }
    })
    // identify new scenario layer and add it to the map
    const layers = []
    for (let bridgeName of state.bridges) {
      console.log("bridgeToCheck", bridgeName)
      layers.push(Bridges.layers.filter(layer => layer.id === bridgeName)[0])
    }
      console.log("found layers", layers)
      if (layers) {
        const mapSource = Bridges.mapSource
        rootState.cityPyO.getLayer(mapSource.data.id)
            .then(source => {
              dispatch('addSourceToMap', source, {root: true})
                .then(source => {
                  layers.forEach(layer => {
                    dispatch('addLayerToMap', layer, {root: true})
                  })
                })
            })
        }
  },
  addMultiLayerAnalysisLayer({state, commit, dispatch, rootState}, features) {
    // update layer on map
    let source = MultiLayerAnalysisConfig.mapSource
    source.options.data.features = features
    dispatch('addSourceToMap', source, {root: true})
      .then(source => {
        dispatch('addLayerToMap', MultiLayerAnalysisConfig.layer, {root: true})
      })
  },
  addSubSelectionLayer({state, commit, dispatch, rootState}, features) {
    // update layer on map
    let source = SubSelectionLayerConfig.mapSource
    source.options.data.features = features
    dispatch('addSourceToMap', source, {root: true})
      .then(source => {
        dispatch('addLayerToMap', SubSelectionLayerConfig.layer, {root: true})
      })
  },
  addMultiLayerPerformanceInfos({state, commit, dispatch, rootState}, features) {
    // update layer on map
    let source = PerformanceInfosConfig.mapSource
    source.options.data.features = features
    dispatch('addSourceToMap', source, {root: true})
      .then(source => {
        dispatch('addLayerToMap', PerformanceInfosConfig.layer, {root: true})
      })
  },
  //LOADING INITIAL ABM DATA
  initialAbmComputing({state, commit, dispatch, rootState}, workshopScenario){
    //show loading screen
    commit('resultLoading', true)
    commit("loader", true);

    //check if special workshop Scenario should be loaded
    let scenarioName = workshopScenario || abmTripsLayerName

    //LOAD DATA FROM CITYPYO

    commit("loaderTxt", "Getting ABM Simulation Data from CityPyO ... ");
    rootState.cityPyO.getAbmResultLayer(scenarioName, state).then(
      result => {
        if (!result) {
          alert("There was an error requesting the data from the server. Please get in contact with the admins.");
          //remove loading screen
          commit('resultLoading', false)
          return
        }


        commit("loaderTxt", "Serving Abm Data ... ");
        dispatch("computeLoop", result.options?.data)
          .then(unused => {
            dispatch('calculateStats')
        })
      }
    )
  },
  //compute ABM Data Set
  computeLoop({state, commit, dispatch, rootState}, abmCore){

    var agentIndexes = {};
    var abmFilterData = {};
    var timePaths = [];
    var simpleTimeData = {};
    var trips = []

    console.log(abmCore);
    //go through each agent inside the abm set (agent, index, array)

    commit("loaderTxt", "Clustering ABM Data for functional purposes ... ");
    abmCore.forEach((who,index,array) => {
      let agent_id = who.agent.id;

      // #0 create a simple lookup with all agent id's and their index in the abmCore
      agentIndexes[agent_id] = index

      // #1 create a bin with data on trips each agent makes (origin, destination, pathIndexes, duration, length)
      if (who.trips) {
        for (let trip of who.trips) {
            // trip has following information {"agent", "origin", "destination", "length", "duration", "pathIndexes" }
           trip["agent"] = agent_id
           trips.push(trip)
        }
      }

      // #2 Clustering Agent Sets for faster Filtering in Frontend
      // ---------------- FILTER SET -----------------------------
      for (const [key, value] of Object.entries(who.agent)) {
        if(`${key}` !== 'id' && `${key}` !== 'source'){
          if(`${value}` !== 'unknown' && `${value}` !== 'nil'){
            abmFilterData[`${value}`] = abmFilterData[`${value}`] || [];
            abmFilterData[`${value}`].push(agent_id);
          }
        }
      }

      // ---------------- FILTER SET END--------------------------

      // #3 Clustering TIME DATA for Aggregation Layer
      // ---------------- TIME DATA ------------------------------


      commit("loaderTxt", "Analyzing Time Data ... ");
      who.timestamps.forEach((v,i,a) => {
        /*round timestamps to full hours*/
        var h = Math.floor(v / 3600) + 8;
        /*create object keys from full hours*/
        timePaths[h] = timePaths[h] || {};
        timePaths[h].busyAgents = timePaths[h].busyAgents || [];
        timePaths[h].values = timePaths[h].values || {};
        timePaths[h].stamps = timePaths[h].stamps + 1 || 1;
        let coords = who.path[i].toString();

        timePaths[h].values[coords] = timePaths[h].values[coords] || [];
        //timePaths[h].values[coords].agents = timePaths[h].values[coords].agents || [agent_id];
        if (!timePaths[h].values[coords].includes(agent_id)) timePaths[h].values[coords].push(agent_id);
        //timePaths[h].values[coords].weight = timePaths[h].values[coords].agents.length;

        /*simpleTimeData[v] = simpleTimeData[v] || [];
        simpleTimeData[v].push(agent_id);*/


        commit("loaderTxt", "Creating Simple Time Data Arrays ... ");
        simpleTimeData[Math.floor(v/300)*300] = simpleTimeData[Math.floor(v/300)*300] || {};
        simpleTimeData[Math.floor(v/300)*300]["all"] = simpleTimeData[Math.floor(v/300)*300]["all"] || [];
        simpleTimeData[Math.floor(v/300)*300][who.agent.mode] = simpleTimeData[Math.floor(v/300)*300][who.agent.mode] || [];
        simpleTimeData[Math.floor(v/300)*300][who.agent.agent_age] = simpleTimeData[Math.floor(v/300)*300][who.agent.agent_age] || [];
        simpleTimeData[Math.floor(v/300)*300][who.agent.resident_or_visitor] = simpleTimeData[Math.floor(v/300)*300][who.agent.resident_or_visitor] || [];
        simpleTimeData[Math.floor(v/300)*300]["all"].push(agent_id);
        simpleTimeData[Math.floor(v/300)*300][who.agent.mode].push(agent_id);
        simpleTimeData[Math.floor(v/300)*300][who.agent.agent_age].push(agent_id);
        simpleTimeData[Math.floor(v/300)*300][who.agent.resident_or_visitor].push(agent_id);


        commit("loaderTxt", "Creating Busy Agents ... ");
        if(i == 0){
          timePaths[h].busyAgents.push(agent_id);
        }
      });

      // ---------------- TIME DATA END---------------------------

    }); //END OF COMPUTING LOOP

    //functions working on whole data set

    //Commit computed results to the store
    commit('agentIndexes', Object.freeze(agentIndexes));
    commit('clusteredAbmData', Object.freeze(abmFilterData));
    commit('abmTimePaths', Object.freeze(timePaths));
    commit('activeTimePaths', Object.freeze(timePaths));
    commit('abmTrips', Object.freeze(trips));

    console.log("trips", trips)
    console.log(timePaths);

    commit('abmSimpleTimes', Object.freeze(simpleTimeData));
    commit('activeAbmSet', Object.freeze(abmCore));

    //buildLayers
    dispatch("buildLayers");

    //layer Show/Hide

    // hide loading screen
    commit('resultLoading', false);
    commit('loader', false);
  },
  buildLayers({state, commit, dispatch, rootState}){
    const tripsLayerData = state.activeAbmSet;
    const heatLayerData = state.activeTimePaths;
    const currentTimeStamp = 0
    const heatLayerFormed = [];

    buildTripsLayer(tripsLayerData, currentTimeStamp).then(
      deckLayer => {
        if (rootState.map?.getLayer(abmTripsLayerName)) {
          rootState.map?.removeLayer(abmTripsLayerName)
        }

        // check if scenario is still valid - user input might have changed while loading trips layer
        rootState.map?.addLayer(deckLayer);
        console.log("new trips layer loaded");
        commit('addLayerId', abmTripsLayerName, {root: true});
        commit('animationRunning', true);
        animate(deckLayer, null, null, currentTimeStamp)
      }
    );

    //preparing Data for HeatMap Layer
    Object.entries(heatLayerData).forEach(([key, value]) => {
      Object.entries(heatLayerData[key].values).forEach(([subKey, subValue]) => {
        let coordinate = { c: subKey.split(",").map(Number), w: heatLayerData[key].values[subKey].length };
        heatLayerFormed.push(coordinate);
      })
    });

    buildAggregationLayer(heatLayerFormed, "default").then(
      deckLayer => {
        if (rootState.map?.getLayer(abmAggregationLayerName)) {
          rootState.map?.removeLayer(abmAggregationLayerName)
        }

        console.log("new aggregation layer loaded");
        rootState.map?.addLayer(deckLayer)
        commit('addLayerId', abmAggregationLayerName, {root: true});
        commit('heatMap', true);
        console.log(state.heatMap);

      });
  },
  updateLayers({state, commit, dispatch, rootState}, layer){
    const range = state.selectedRange;
    const type = state.heatMapType;
    const tripsLayerData = state.activeAbmSet;
    const heatLayerData = state.activeTimePaths;
    const currentTimeStamp = state.currentTimeStamp;
    const heatLayerFormed = [];

    if(layer == "tripsLayer" || layer == "all"){
      buildTripsLayer(tripsLayerData, currentTimeStamp).then(
        deckLayer => {
          if (rootState.map?.getLayer(abmTripsLayerName)) {
            rootState.map?.removeLayer(abmTripsLayerName)
          }

          // check if scenario is still valid - user input might have changed while loading trips layer
          rootState.map?.addLayer(deckLayer);
          console.log("new trips layer loaded");
          commit('addLayerId', abmTripsLayerName, {root: true});
          if(state.animationRunning){
            animate(deckLayer, null, null, currentTimeStamp)
          }
        }
      );
    }

    if(layer == "heatMap" || layer == "all"){
      Object.entries(heatLayerData).forEach(([key, value]) => {

        if(key >= range[0] && key <= range[1]){
          Object.entries(heatLayerData[key].values).forEach(([subKey, subValue]) => {

            heatLayerData[key].values[subKey].forEach((v,i,a) => {
              if(!heatLayerData[key].busyAgents.includes(v)){
                heatLayerData[key].values[subKey].splice(i, 1);
              }
            });

            if(heatLayerData[key].values[subKey].length > 0){
              let coordinate = { c: subKey.split(",").map(Number), w: heatLayerData[key].values[subKey].length };
              heatLayerFormed.push(coordinate);
            } else {
            }
          });
        }
      });

      buildAggregationLayer(heatLayerFormed, type).then(
        deckLayer => {
          if (rootState.map?.getLayer(abmAggregationLayerName)) {
            rootState.map?.removeLayer(abmAggregationLayerName)
          }
          console.log("new aggregation layer loaded");
          rootState.map?.addLayer(deckLayer)
          commit('addLayerId', abmAggregationLayerName, {root: true})
        });
    }
  },
  addArcLayer({state, commit, dispatch, rootState}, arcLayerData) {
    buildArcLayer(arcLayerData).then(
      deckLayer => {
        if (rootState.map?.getLayer(abmArcLayerName)) {
          rootState.map?.removeLayer(abmArcLayerName)
        }

        console.log("new arc layer loaded");
        rootState.map?.addLayer(deckLayer)
        commit('addLayerId', abmArcLayerName, {root: true});
        rootState.map?.flyTo({"zoom": 15, "pitch": 45, "speed": 0.2})
      });
  },
  filterAbmCore({state, commit, dispatch, rootState}, filterSettings){
      const abmData = state.activeAbmSet;
      const timePaths = state.abmTimePaths;
      const filterSet = {...state.clusteredAbmData};
      const spliceArr = [];

      Object.entries(filterSettings).forEach(([key, value]) => {
        if(value === true){
          delete filterSet[key];
        } else {
          filterSet[key].forEach(v => {
            spliceArr.push(v);
          });
        }
      });

      const filteredTimePaths = JSON.parse(JSON.stringify(timePaths));
      console.log(filteredTimePaths);
      const filteredAbm = abmData.filter(v => !spliceArr.includes(v.agent.id));
      Object.entries(filteredTimePaths).forEach(([key, value]) => {
        if(value){
          filteredTimePaths[key].busyAgents = filteredTimePaths[key].busyAgents.filter(v => !spliceArr.includes(v));
        }
      });

      console.log("new Filter Setting applied");
      commit('activeAbmSet', Object.freeze(filteredAbm));
      commit('activeTimePaths', Object.freeze(filteredTimePaths));
      dispatch('updateLayers', "all");
      commit("loader", false);
  }
}

function updateBridges(bridge_hafencity, bridge_veddel) {
  let bridges = []

  if (bridge_hafencity) {
    bridges.push(bridgeNames.bridge_hafencity)
  }
  if (bridge_veddel == bridgeVeddelOptions.horizontal) {
    bridges.push(bridgeNames.bridge_veddel_horizontal)
  }
  if (bridge_veddel == bridgeVeddelOptions.diagonal) {
    bridges.push(bridgeNames.bridge_veddel_diagonal)
  }

  return bridges
}

function isNoiseScenarioMatching(noiseDataSet,noiseScenario) {
  return noiseDataSet["noise_scenario"]["traffic_percent"] == noiseScenario.traffic_percent
    && noiseDataSet["noise_scenario"]["max_speed"] == noiseScenario.max_speed;
}
