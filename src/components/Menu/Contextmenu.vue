<script>
import { mapState } from 'vuex'
import * as turf from '@turf/turf'
import {alkisTranslations} from "@/store/abm";
import {generateStoreGetterSetter} from "@/store/utils/generators";
import AmenitiesLayerDefinition from '@/config/amenities.json'
import {getOdArcData} from '@/store/scenario/odArcs.ts'
import {abmArcLayerName} from "@/store/deck-layers";

export default {
    name: 'Contextmenu',
    components: {},
    data() {
        return {
            lineCanvasId: null,
            active: false,
            indexVal:0,
            modalDiv:'',
            dragging: false,
            windowWidth: window.innerWidth,
            objectFeatures: [],
            objectId: null,
            modalInfo: {},
            arcLayerData: {},
            asOrigin:false,
            asDestination:false,
            minOdTrips: 1,
            noTripsWarning: false
        }
    },
    computed: {
      ...mapState([
        'allFeaturesHighlighted',
        'map',
        ]),
      ...generateStoreGetterSetter([
        ['openModalsIds', 'openModalsIds'],
        ['modalIndex', 'modalIndex'],
      ]),
        // city_scope_id of the clicked object (set in Map.vue, onMapClick)
        selectedObjectId() {
          return this.$store.state.selectedObjectId;
        },
        abmTrips(){
            return this.$store.state.scenario.abmTrips;
        }
    },
    beforeMount(){
      if (!this.selectedObjectId) {
        console.log("Tried to open modal, but no selectedObjectId given")
        return
      }

      // new object selected, circleObject and create modal
      this.objectId = this.selectedObjectId.toString()  // disconnect from store
      this.createObjectFeatures()
      this.gatherModalInfo()
      this.toggleFeatureCircling()
      this.toggleFeatureHighlighting()
    },
    watch: {
      asOrigin(newVal, oldVal) {
        if (newVal && this.asDestination) {
          this.asDestination = false;
        }
        if (newVal) {
          // get new data and add new layer to map
          this.getArcLayerData(this.objectFeatures, true).then(() => {
            this.updateOdTripsLayer()
          })
        } else {
          this.map?.removeLayer(abmArcLayerName);
        }
      },
      asDestination(newVal, oldVal) {
        if (newVal && this.asOrigin) {
          this.asOrigin = false;
        }
        if (newVal) {
          // get new data and add new layer to map
          this.getArcLayerData(this.objectFeatures, false).then(() => {
            this.updateOdTripsLayer()
          })
        } else {
          this.map?.removeLayer(abmArcLayerName);
        }
      },
      /** filter arcLayerData with new minOdTrips value and renew layer */
      minOdTrips() {
        this.updateOdTripsLayer()
      },
    },
    mounted(){
        let selector = this.$el;
        this.modalDiv = selector.closest(".vm--modal");
        this.selectedModal();

        if(window.innerWidth >= 1024){
            this.sleep(300).then(() => { this.createLineOnCanvas(); });
        }

        this.active = true;

        if(window.innerWidth >= 1024){
            this.map.on('drag', this.createLineOnCanvas);
            this.map.on('zoom', this.createLineOnCanvas);
            this.map.on('rotate', this.createLineOnCanvas);
        }
        window.addEventListener('mouseup', this.stopDrag);
    },
    updated(){
    },
    beforeDestroy() {
      this.toggleFeatureCircling()

      if (!this.allFeaturesHighlighted) {
        this.toggleFeatureHighlighting()
      }

      if (this.map?.getLayer(abmArcLayerName)) {
        this.map?.removeLayer(abmArcLayerName)
      }


      // remove line on canvas connecting modal to selected feature
      const canvas = document.getElementById(this.lineCanvasId);
      canvas.remove();
      this.active = false;

      this.openModalsIds.splice(this.openModalsIds.indexOf(this.selectedObjectId), 1);
    },
    methods:{
        createObjectFeatures() {
          const renderedFeatures = this.map.queryRenderedFeatures()
          this.objectFeatures = renderedFeatures.filter(feat => {
            return feat.properties["city_scope_id"] === this.objectId
          })
        },
        gatherModalInfo() {
          this.modalInfo = {
            "objectType": "",
            "generalContent" : [], // [{ propTitle: propValue}, ..]}
            "detailContent" : {} // header : [{ propTitle: propValue}]}
          }

          // iterate over objects features and add modal info, depending on feature layer or type
          this.objectFeatures.forEach((feature,i,a) => {
            const layerId = feature.layer.id
            switch (layerId) {
              case "groundfloor":
                this.modalInfo["objectType"] = "building"
                this.modalInfo["coords"] = turf.centroid(turf.polygon(feature.geometry.coordinates)).geometry.coordinates
                this.addBuildingFloorInfo(feature)
                break;
              case "rooftop":
                // add also roof type here when available
                this.addBuildingFloorInfo(feature)
                break;
              case "upperfloor":
                this.addBuildingFloorInfo(feature)
                this.modalInfo["generalContent"].push(
                  {"building height": feature.properties["building_height"].toString() + "m"}
                )
                break;
              case AmenitiesLayerDefinition.layer.id:
                this.modalInfo["objectType"] = "amenity"
                this.modalInfo["coords"] =feature.geometry.coordinates
                this.modalInfo["detailContent"]["Amenity"] = {}
                const alkisId = feature.properties.GFK
                feature.properties["useType"] = alkisTranslations[alkisId] || alkisId
                this.modalInfo["detailContent"]["Amenity"] = [
                  {"New amenity ?": feature.properties["Pre-exist"] ? "No" : "Yes"},
                  {"Use Type": feature.properties["useType"]},
                  {"GFK": feature.properties.GFK}
                ]
                break;
            }
          })
        },
        addBuildingFloorInfo(feature) {
          this.modalInfo["detailContent"][feature.layer.id] = [
              {"use case": feature.properties.land_use_detailed_type},
              {"floor area": Math.round(feature.properties["floor_area"]).toString() + "m²"}
            ]
        },
        toggleFeatureHighlighting() {
          if (this.allFeaturesHighlighted) {
            // do not change highlighting
            return
          }
          // update properties for all objectFeatures
          this.objectFeatures.forEach(feature => {
            // set display properties for selected features to change volume colors
            const alreadyHighlighted = (feature.properties.selected === "active")
            feature.properties.selected = alreadyHighlighted ? "inactive" : "active";
            this.$store.dispatch('editFeatureProps', feature);
          })
        },
        /** circles or uncircles clickedFeatures */
        toggleFeatureCircling() {
          let buffer = null

          console.log("features", this.objectFeatures)

          // find geometry to create circle around the object
          this.objectFeatures.every(feature => {
            if (feature.layer.id === "groundfloor") {
              buffer = turf.buffer(turf.polygon(feature.geometry.coordinates), 0.015)
              // if a ground floor found: jump out - it is the perfect geometry for circling a building
              return false;
            }
            if (feature.layer.id === "upperfloor") {
              buffer = turf.buffer(turf.polygon(feature.geometry.coordinates), 0.015)
              // if a upper floor found: take as fallback geometry for circling.
              return true;
            }
            if (feature.layer.id === AmenitiesLayerDefinition.layer.id) {
              buffer = turf.buffer(turf.point(feature.geometry.coordinates), 0.015)
            }
              return true;
          })
          // update circled features
          buffer.properties["objectId"] = this.objectId
          this.$store.dispatch("updateCircledFeaturesLayer", buffer)
        },
        getProjectedObjectCoords() {
          return this.map.project(this.modalInfo["coords"])
        },
        async getArcLayerData(objectData, asOrigin) {
          this.arcLayerData = await getOdArcData(objectData, this.modalInfo, asOrigin)
        },
        filterArcLayerData() {
          if (this.minOdTrips === 1 || this.arcLayerData.length === 0) {
            // no need to filter
            return this.arcLayerData
          }

          // filter for trips that with min. amount of similar trips
          return this.arcLayerData.filter(datapoint => {
            /* datapoint schema
             "color": [254, 227, 81],
             "source": number[],
             "target": number[],
             "width": number  // number of trips with same origin / destination
             */
            return datapoint.width >= this.minOdTrips
          })
        },
        updateOdTripsLayer() {
          // filter data first
          const data = this.filterArcLayerData()

          if (data.length === 0) {
            // empty dataset (after filtering) , remove layer
            if (this.map?.getLayer(abmArcLayerName)) {
              this.map?.removeLayer(abmArcLayerName);
            }
            this.noTripsWarning = true // show warning for empty datasets
            return
          }

          this.$store.dispatch('scenario/addArcLayer', data);
          this.noTripsWarning = false
          console.log("new arc layer with # trips = ", data.length)
        },
        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },
        selectedModal(){
            this.modalIndex += 1;
            let selector = this.$el;
            let targetModal = selector.closest(".vm--container");
            targetModal.style.zIndex = this.modalIndex;
        },
         /** creates a line on canvas connecting the modal box to it's object as anchor */
        createLineOnCanvas(){
           if(window.innerWidth >= 1024) {
             if (this.active) {
               this.lineCanvasId = "line_" + this.objectId;
               const boxContainer = document.getElementById("line_canvas");
               if (document.getElementById(this.lineCanvasId)) {
                 // remove existing line container
                 boxContainer.removeChild(document.getElementById(this.lineCanvasId))
               }

               // create canvas
               let canvas = document.createElement('canvas');
               canvas.id = this.lineCanvasId
               canvas.width = window.innerWidth;
               canvas.height = window.innerHeight;
               canvas.style.position = "absolute";
               boxContainer.appendChild(canvas);
               var context = canvas.getContext('2d');

               const projectedObjectCoords = this.getProjectedObjectCoords()
               const anchorConnnection = {
                 x: projectedObjectCoords.x,
                 y: projectedObjectCoords.y,
               }

               const boxConnection = {}
               boxConnection.x = parseInt(this.modalDiv.style.left, 10) + this.modalDiv.getBoundingClientRect().width / 2;
               boxConnection.y = parseInt(this.modalDiv.style.top, 10) + this.modalDiv.getBoundingClientRect().height / 2;

               context.canvas.width = window.innerWidth;
               context.canvas.height = window.innerHeight;
               context.beginPath();
               context.lineWidth = "1";
               context.strokeStyle = "#FEE351";
               context.moveTo(Math.round(boxConnection.x), Math.round(boxConnection.y));
               context.lineTo(Math.round(anchorConnnection.x), Math.round(anchorConnnection.y));
               context.stroke();
             }
           }
        },
        startDrag() {
            this.dragging = true;
        },
        stopDrag() {
            this.dragging = false;
        },
        doDrag(event) {
            if (this.dragging && window.innerWidth >= 1024) {
                this.createLineOnCanvas();
            }
        }
    }
}
</script>

<template>
    <div class="ctx_menu" @click="selectedModal()"  @mousedown="startDrag" @mousemove="doDrag" v-bind:style="{ zIndex: indexVal }">
        <div class="wrapper">
            <div class="ctx_bar"><v-icon size="18px">mdi-city</v-icon> <p>{{ modalInfo.objectType }} - {{ objectId }}</p><div class="close_btn" @click="$emit('close')"><v-icon>mdi-close</v-icon></div></div>
            <div class="general" v-for="item in modalInfo.generalContent"><p>
                <div v-for="(value, key) in item">
                  <p>{{ key }} : {{ value }}</p>
                </div>
              </div>
            </div>
            <div class="head_scope" v-for="(content, name) in modalInfo.detailContent">
                <div class="head_bar"><h3>{{ name }}</h3></div>
                    <div v-for="ctx in content">
                      <div v-for="(value, key) in ctx">
                        <p><strong>{{ key }}</strong> {{value}} </p>
                      </div>
                    </div>
            </div>
          <!-- Origin // Destination checkboxes -->
            <div class="body_scope"></div>
            <div v-if="abmTrips" class="od-menu">
            <v-checkbox
                v-model="asOrigin"
                label="Origin of"
                dark
                hide-details
              ></v-checkbox>
              <v-checkbox
                v-model="asDestination"
                label="Destination of"
                dark
                hide-details
              ></v-checkbox>
              <v-slider style="margin-top: 15px;"
                @dragstart="_ => null"
                @dragend="_ => null"
                @mousedown.native.stop="_ => null"
                @mousemove.native.stop="_ => null"
                v-model="minOdTrips"
                step=1
                thumb-label="always"
                label="Min. Trips"
                thumb-size="25"
                tick-size="50"
                min="1"
                max=20
                dark
                flat
              ></v-slider>
              <div v-if="noTripsWarning" class="warn">No trips to show</div>
            </div>
        </div>
        <!--<svg class="connection"><line :x1="Math.round(anchorConnnection.x)" :y1="Math.round(anchorConnnection.y)" :x2="Math.round(boxConnection.x)" :y2="Math.round(boxConnection.y)" stroke-width="1px" stroke="white"/></svg>-->
    </div>
</template>

<style scoped lang='scss'>
    @import "../../style.main.scss";

    .ctx_menu {
        position:relative;
        //position:fixed;
        width:280px;
        //min-height:200px;
        background:rgba(0,0,0,0.75);
        max-width:100%;
        padding:5px;
        border:1px solid #FEE351;
        box-sizing: border-box;
        @include drop_shadow;

        p {
          color:whitesmoke;
          font-size:100%;
          strong {
            font-size:80%;
            color:#ddd;
          }
        }

        .ctx_bar {
            position:relative;
            display:flex;
            width:100%;
            height:30px;
            line-height:30px;
            background:$reversed;
            padding:0px 5px;

            .v-icon {
                opacity:1;
                filter:invert(1);
                flex:0 0 35px;
            }

            .close_btn {
                position:absolute;
                top:0;
                right:0;
                width:30px;
                height:30px;
                border:2px solid white;

                .v-icon {
                    position:absolute;
                    left:50%;
                    top:50%;
                    transform:translate(-50%,-50%);
                    color:black;
                    font-size:15px;
                }
            }

            &:hover {
                cursor:pointer;
            }
        }

        .general {
            padding:5px;
            box-sizing: border-box;

            p {
                font-size:80%;
                color:whitesmoke;
                font-weight:300;
            }
        }

        .head_scope{
            width:90%;
            margin:5px auto;
            color:whitesmoke;
            border:1px solid #444;
            box-sizing: border-box;
            font-size:80%;

            .head_bar {
                position:relative;
                margin:5px auto;
                padding:0px 10px;
                box-sizing: border-box;
                width:95%;
                height:30px;
                line-height:30px;
                font-size:100%;
                z-index:3;
                //background:linear-gradient(45deg, $red, transparent);
                @include drop_shadow;

                &:after {
                    @include fullpseudo;
                    background:$greyblue;
                    opacity:0.75;
                    z-index:-1;
                }

                 h3 {
                color:whitesmoke;
                font-size:100%;
                font-weight:300;
                }
            }

            p {
                border-top:1px solid #444;
                padding:2px 10px;
                box-sizing: border-box;
                &:first-child {
                    border:none;
                }
            }
        }

       .warn {
         color: darkred;
         margin-top: 10px;
       }

        &:hover {
            border:1px solid $orange;
            background:rgba(0,0,0,0.95);
        }

        @media(max-device-width:1023px){
            position:fixed;
            width:80%;
            max-width:400px;
            min-height:50vh;
            top:50%;
            left:50%;
            transform:translate(-50%,-50%);
            border:none;
            background:rgba(0,0,0,0.85);
            backdrop-filter:blur(10px) saturate(180%);
        }
    }

</style>
