import { ChangeEvent, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  ArrowDown,
  ArrowUp,
  Box,
  Activity,
  AlertTriangle,
  Check,
  Circle,
  ChevronLeft,
  ChevronRight,
  Copy,
  Cuboid,
  Download,
  Eye,
  EyeOff,
  FileJson,
  Focus,
  FolderOpen,
  Grid3X3,
  Hammer,
  HelpCircle,
  Import,
  Lock,
  Link2,
  Magnet,
  Palette,
  Move3D,
  Play,
  Redo2,
  RotateCw,
  Save,
  Scaling,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Pause,
  Trash2,
  Undo2,
  Unlock,
  X,
} from 'lucide-react';
import {
  ExportProfileId,
  ExportReport,
  buildExportReport,
  exportProfiles,
  getExportProfile,
  runExportPreflight,
} from '../application/exportCenter';
import { validateProject } from '../application/validation';
import { cloneSceneNode, createBoxNode, createCylinderNode, createEmptyProject, createPlaneNode, createSphereNode } from '../domain/factory';
import { clampGeneratorParams, createGeneratorNode, generatorDefinitions, getGeneratorDefinition } from '../domain/generators';
import {
  AssetDocument,
  EditorTool,
  GeometryDefinition,
  ImportedModelGeometry,
  JointMotionKind,
  MaterialDefinition,
  MotionAxis,
  PartEditMode,
  PartWarehouseAssemblyItem,
  PartWarehousePartItem,
  PartWarehouseItem,
  PieceReferenceCenter,
  SceneNode,
  Transform,
  ValidatedJointMotion,
  ValidationIssue,
  Vector3Tuple,
} from '../domain/model';
import type { KinematicGraph, KinematicMotionClip } from '../domain/kinematics';
import type { KinematicJoint, MechanicalPart } from '../domain/kinematics';
import type { AssemblyConnection, FunctionalComponent, FunctionalComponentMotionDefinition, MechanicalInterfaceKind } from '../domain/mechanics';
import {
  acceptJointCandidate,
  createHomeKinematicState,
  createJoint,
  rejectJointCandidate,
  removeJoint,
  resetKinematicState,
  normalizeAxis,
  setJointValue,
  updateJoint,
  validateKinematicGraph,
} from '../application/kinematics/kinematicAuthoring';
import {
  buildRobotPickAndPlaceSequence,
  createRobotServoState,
  sampleKinematicMotionClip,
  startRobotSequence,
  updateRobotServo,
} from '../application/kinematics/robotMotionController';
import { createIndustrialSceneModelNode, createIndustrialScenePackNodes, industrialSceneModelIds } from '../application/industrialScene/industrialScenePack';
import { createScenarioOneRealCellNodes } from '../application/industrialScene/scenarioOneRealCell';
import type { RobotServoState } from '../application/kinematics/robotMotionController';
import {
  createPlcTwinProjectForNode,
  runPlcModbusSimulationFrame,
  type PlcSimulationFrame,
  type PlcRegister,
} from '../application/twin/plcModbusSimulation';
import {
  createVirtualPlcRuntime,
  executeVirtualPlcScan,
  resetVirtualPlcFault,
  setVirtualPlcInput,
  setVirtualPlcScanTarget,
  type VirtualPlcInputs,
  type VirtualPlcRuntime,
} from '../application/twin/virtualPlcRuntime';
import type { ConnectionHealth, ConnectionProfile, ProtocolKind, TwinProject } from '../domain/twin';
import { createTwinProjectFromAssetDocument } from '../application/twin/twinFoundation';
import { ProtocolAdapterRegistry } from '../application/twin/protocolAdapter';
import { TwinAxisConnectionManager } from '../application/twin/connectionManager';
import { MqttAdapter } from '../infrastructure/protocols/mqtt/MqttAdapter';
import { OpcUaGatewayAdapter } from '../infrastructure/protocols/opcua/OpcUaGatewayAdapter';
import { createTwinPackage, parseTwinPackage, serializeTwinPackage } from '../application/twin/twinPackage';
import { deterministicReplayHash, replayRecords, type HistorianRecord } from '../application/twin/historianReplay';
import { IndexedDbTwinHistorian } from '../infrastructure/twinHistorianRepository';
import { acknowledgeAlarm, evaluateAlarmRules, shelveAlarm, type AlarmInstance, type AlarmPriority, type AlarmRule } from '../application/twin/alarmEngine';
import { runSimulationScenario, validateSimulationScenario, type SimulationScenario } from '../application/twin/simulationScenario';
import {
  isDesktopRuntime,
  openProjectNative,
  saveBlobNative,
  saveJsonNative,
  saveProjectNative,
} from '../infrastructure/desktopFileSystem';
import { downloadBlob, exportDocumentAsGlb, exportJsonReport, renderDocumentPreview } from '../infrastructure/exportGlb';
import { createImportedModelNode } from '../infrastructure/importGlb';
import {
  downloadProjectFile,
  loadProjectAutosave,
  loadProjectFromBrowser,
  saveProjectAutosave,
  saveProjectToBrowser,
} from '../infrastructure/projectStorage';
import {
  deleteWarehouseItem as deletePersistentWarehouseItem,
  loadWarehouseItems,
  loadWarehouseItemsWithFallback,
  loadWarehouseStorageInfo,
  saveWarehouseGlbItem,
  saveWarehouseItems,
  saveWarehouseThumbnail,
  type WarehouseStorageInfo,
  warehouseItemKey,
} from '../infrastructure/warehouseRepository';
import { createIndependentWarehousePartGeometry } from '../infrastructure/warehouseParts';
import {
  ImportedPartSelection,
  KinematicAxisChangeEvent,
  KinematicEditTarget,
  KinematicPointPickEvent,
  PieceReferenceCenterEstimateEvent,
  MotionTrainingPreview,
  RobotCursorGuideEvent,
  ThreeViewport,
  ViewportContextMenuEvent,
  ViewportStats,
} from './components/ThreeViewport';
import { AdvancedRigWorkspace } from './components/AdvancedRigWorkspace';
import { buildFunctionalAssembly, buildFunctionalComponent, validateFunctionalAssembly } from '../application/mechanics/functionalModel';
import { solveRobotArmCursorTarget } from '../application/kinematics/robotCursorGuidance';

const makeStarterProject = () => {
  const project = createEmptyProject('Prototype Asset');
  const cube = createBoxNode();
  return {
    ...project,
    nodes: [cube],
    selectedNodeId: cube.id,
  };
};

const loadInitialProject = () => {
  try {
    return loadProjectFromBrowser() ?? makeStarterProject();
  } catch {
    return makeStarterProject();
  }
};

const loadProjectRuntimeCollection = <T,>(projectId: string, name: string): T[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`twinaxis.${name}.${projectId}`) ?? '[]');
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
};

const touch = (document: AssetDocument): AssetDocument => ({
  ...document,
  metadata: {
    ...document.metadata,
    updatedAt: new Date().toISOString(),
  },
});

const selectedName = (geometry: GeometryDefinition) => {
  if ('generatorId' in geometry) return getGeneratorDefinition(geometry.generatorId)?.name ?? 'Unknown Generator';
  if (geometry.kind === 'imported-model') return `Imported ${geometry.sourceFormat.toUpperCase()}`;
  if (geometry.kind === 'serialized-object') return 'Stored Part';
  return geometry.kind.charAt(0).toUpperCase() + geometry.kind.slice(1);
};

const isStarterPlaceholderNode = (node: SceneNode) =>
  node.name === 'Game Box' &&
  node.geometry.kind === 'box' &&
  node.geometry.width === 2 &&
  node.geometry.height === 1.4 &&
  node.geometry.depth === 2 &&
  node.transform.position[0] === 0 &&
  node.transform.position[1] === 0.5 &&
  node.transform.position[2] === 0 &&
  node.transform.rotation.every((value) => value === 0) &&
  node.transform.scale.every((value) => value === 1);

const materialPresets: MaterialDefinition[] = [
  { name: 'Graphite PBR', color: '#3f4953', roughness: 0.52, metalness: 0.08 },
  { name: 'Industrial Steel', color: '#8b949e', roughness: 0.34, metalness: 0.78 },
  { name: 'Military Black', color: '#20262a', roughness: 0.72, metalness: 0.25 },
  { name: 'Safety Orange', color: '#d66b2c', roughness: 0.46, metalness: 0.12 },
  { name: 'Emissive Red Trim', color: '#34383d', roughness: 0.42, metalness: 0.35, emissive: '#e53935', emissiveIntensity: 1.8 },
  { name: 'Signal Blue', color: '#2874c8', roughness: 0.38, metalness: 0.18 },
  { name: 'Factory Yellow', color: '#d4a62a', roughness: 0.5, metalness: 0.16 },
  { name: 'Hydraulic Green', color: '#2f7d57', roughness: 0.56, metalness: 0.12 },
  { name: 'Ceramic White', color: '#d9dee2', roughness: 0.32, metalness: 0.04 },
  { name: 'Anodized Violet', color: '#6d4cc2', roughness: 0.3, metalness: 0.45 },
  { name: 'Robot Orange', color: '#e85d12', roughness: 0.4, metalness: 0.14 },
  { name: 'Machine Red', color: '#b92f2f', roughness: 0.48, metalness: 0.16 },
  { name: 'Deep Black', color: '#0f1215', roughness: 0.64, metalness: 0.28 },
  { name: 'Aluminum Light', color: '#c9cdd1', roughness: 0.26, metalness: 0.86 },
  { name: 'Workshop Teal', color: '#168f8b', roughness: 0.44, metalness: 0.18 },
];

type MotionTrainingCandidate = {
  id: string;
  nodeId: string;
  jointName: string;
  jointLabel: string;
  label: string;
  motionKind: JointMotionKind;
  axis: MotionAxis;
  min: number;
  max: number;
  amplitude: number;
};

type MotionTrainerState = {
  nodeId: string;
  candidates: MotionTrainingCandidate[];
  index: number;
};

const motionAxes: MotionAxis[] = ['x', 'y', 'z'];

const motionKindText = (kind: JointMotionKind) => (kind === 'translation' ? 'Slide' : 'Rotate');

const axisIndexOf = (axis?: MotionAxis) => (axis === 'y' ? 1 : axis === 'z' ? 2 : 0);

const makeMotionRange = (kind: JointMotionKind, preferred: boolean, min?: number, max?: number, amplitude?: number) => {
  if (kind === 'translation') {
    return { min: -0.35, max: 0.35, amplitude: 0.22 };
  }

  const nextMin = preferred ? min ?? -1.2 : -1.2;
  const nextMax = preferred ? max ?? 1.2 : 1.2;
  const nextAmplitude = Math.min(Math.abs(nextMin), Math.abs(nextMax), amplitude ?? 0.65);
  return { min: nextMin, max: nextMax, amplitude: nextAmplitude };
};

const makeMotionTrainingCandidates = (node: SceneNode): MotionTrainingCandidate[] => {
  if (node.geometry.kind !== 'imported-model') return [];

  const candidates: MotionTrainingCandidate[] = [];
  const seen = new Set<string>();

  node.geometry.joints.forEach((joint) => {
    const primaryAxis = joint.axis ?? 'x';
    const primaryKind = joint.motionKind ?? 'rotation';
    const jointLabel = joint.label ?? joint.name;

    const addCandidate = (motionKind: JointMotionKind, axis: MotionAxis, preferred = false) => {
      const key = `${joint.name}:${motionKind}:${axis}`;
      if (seen.has(key)) return;
      seen.add(key);

      const range = makeMotionRange(motionKind, preferred, joint.min, joint.max, joint.demoAmplitude);
      candidates.push({
        id: key,
        nodeId: node.id,
        jointName: joint.name,
        jointLabel,
        label: `${jointLabel} - ${motionKindText(motionKind)} ${axis.toUpperCase()}`,
        motionKind,
        axis,
        ...range,
      });
    };

    addCandidate(primaryKind, primaryAxis, true);
    motionAxes.forEach((axis) => addCandidate('rotation', axis, axis === primaryAxis && primaryKind === 'rotation'));
    motionAxes.forEach((axis) => addCandidate('translation', axis, axis === primaryAxis && primaryKind === 'translation'));
  });

  return candidates;
};

const legacyAxisVector = (axis?: MotionAxis): [number, number, number] => {
  if (axis === 'y') return [0, 1, 0];
  if (axis === 'z') return [0, 0, 1];
  return [1, 0, 0];
};

const graphFromImportedGeometry = (geometry: ImportedModelGeometry): KinematicGraph => {
  if (geometry.kinematicGraph) return geometry.kinematicGraph;

  const rootPartId = 'part_source_model';
  const sourceBounds = {
    min: [0, 0, 0] as [number, number, number],
    max: geometry.originalBounds,
    size: geometry.originalBounds,
    center: [geometry.originalBounds[0] / 2, geometry.originalBounds[1] / 2, geometry.originalBounds[2] / 2] as [number, number, number],
  };

  return {
    rootPartId,
    parts: [
      {
        id: rootPartId,
        name: 'SOURCE MODEL',
        meshObjectIds: [],
        localFrame: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        bounds: sourceBounds,
        static: true,
        visible: true,
        source: 'imported',
        metadata: { migratedFromLegacyJoints: true },
      },
      ...geometry.joints.map((joint, index) => ({
        id: `part_${index + 1}_${joint.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 48)}`,
        name: joint.label ?? joint.name,
        meshObjectIds: [joint.name],
        localFrame: {
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
        },
        bounds: sourceBounds,
        static: false,
        visible: true,
        source: 'imported' as const,
        metadata: { legacyJointName: joint.name },
      })),
    ],
    joints: geometry.joints.map((joint, index) => ({
      id: `joint_${index + 1}_${joint.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 48)}`,
      name: joint.label ?? joint.name,
      parentPartId: rootPartId,
      childPartId: `part_${index + 1}_${joint.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 48)}`,
      type: joint.motionKind === 'translation' ? ('prismatic' as const) : ('revolute' as const),
      origin: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      axis: legacyAxisVector(joint.axis),
      limits: { lower: joint.min, upper: joint.max },
      source: 'name-heuristic' as const,
      confidence: 0.45,
      evidence: [{ type: 'semantic-name' as const, score: 0.45, message: 'Migrated from legacy articulation controls.' }],
      status: 'candidate' as const,
    })),
  };
};

const graphFromGeometry = (geometry: GeometryDefinition): KinematicGraph | undefined => {
  if (geometry.kind === 'imported-model') return graphFromImportedGeometry(geometry);
  if (geometry.kind === 'serialized-object') return geometry.kinematicGraph;
  if ('generatorId' in geometry) return geometry.kinematicGraph;
  return undefined;
};

type KinematicSceneGeometry = ImportedModelGeometry | Extract<GeometryDefinition, { kind: 'serialized-object' }> | Extract<GeometryDefinition, { generatorId: string }>;

const kinematicGeometryWithGraph = (geometry: GeometryDefinition): geometry is KinematicSceneGeometry =>
  geometry.kind === 'imported-model' || geometry.kind === 'serialized-object' || 'generatorId' in geometry;

const pieceCenterFromBounds = (bounds: Vector3Tuple): Vector3Tuple => [0, bounds[1] / 2, 0];

const geometrySceneBounds = (geometry: KinematicSceneGeometry): Vector3Tuple => geometry.normalizedBounds ?? geometry.originalBounds ?? [1, 1, 1];

const kinematicGeometryAssetName = (geometry: KinematicSceneGeometry, fallback: string) =>
  geometry.kind === 'imported-model' || geometry.kind === 'serialized-object' ? geometry.assetName : getGeneratorDefinition(geometry.generatorId)?.name ?? fallback;

const pieceReferenceCenter = (geometry: KinematicSceneGeometry): Vector3Tuple => geometry.pieceReferenceCenter?.position ?? pieceCenterFromBounds(geometrySceneBounds(geometry));

const createStandalonePieceGraph = (componentId: string, name: string, objectName: string, bounds: Vector3Tuple, referenceCenter = pieceCenterFromBounds(bounds)): KinematicGraph => {
  const center = referenceCenter;
  const rootPartId = `${componentId}_reference`;
  const movingPartId = `${componentId}_body`;
  return {
    rootPartId,
    parts: [
      {
        id: rootPartId,
        name: 'REFERENCE',
        meshObjectIds: [],
        localFrame: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        bounds: {
          min: [-bounds[0] / 2, 0, -bounds[2] / 2],
          max: [bounds[0] / 2, bounds[1], bounds[2] / 2],
          size: bounds,
          center,
        },
        static: true,
        visible: true,
        source: 'manual-group',
        metadata: { pieceReference: true },
      },
      {
        id: movingPartId,
        name,
        meshObjectIds: [objectName, name],
        localFrame: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        bounds: {
          min: [-bounds[0] / 2, 0, -bounds[2] / 2],
          max: [bounds[0] / 2, bounds[1], bounds[2] / 2],
          size: bounds,
          center,
        },
        static: false,
        visible: true,
        source: 'manual-group',
        metadata: { isolatedPiece: true },
      },
    ],
    joints: [
      {
        id: `${componentId}_motion_end_a`,
        name: 'End A motion',
        parentPartId: rootPartId,
        childPartId: movingPartId,
        type: 'fixed',
        origin: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        axis: [0, 0, 1],
        limits: { lower: -0.8, upper: 0.8 },
        source: 'manual',
        evidence: [{ type: 'manual', message: 'No mechanical interface has been accepted for this isolated piece yet.' }],
        status: 'candidate',
      },
    ],
  };
};

const motionDefinitionFromJoint = (joint: KinematicJoint, now = new Date().toISOString()): FunctionalComponentMotionDefinition => {
  const dynamic = joint.type !== 'fixed';
  const twoEnd = false;
  const fixedEndpoint = {
    id: 'fixed_end',
    name: 'Fixed end',
    role: 'fixed' as const,
    position: joint.origin.position,
    axis: joint.axis,
  };
  const movingEndpoint = {
    id: 'moving_end',
    name: 'Moving end',
    role: 'moving' as const,
    position: joint.drivenPoint ?? [joint.origin.position[0] + 1, joint.origin.position[1], joint.origin.position[2]] as Vector3Tuple,
    axis: joint.axis,
  };
  const singleEndpoint = {
    id: 'end_a',
    name: 'Single moving end',
    role: 'single' as const,
    position: joint.origin.position,
    axis: joint.axis,
  };

  return {
    version: 1,
    static: !dynamic,
    endpointMode: twoEnd ? 'two-end' : 'single',
    activeEndpointId: twoEnd ? movingEndpoint.id : singleEndpoint.id,
    endpoints: twoEnd ? [fixedEndpoint, movingEndpoint] : [singleEndpoint],
    movements: dynamic
      ? [
          {
            id: `${joint.id}_movement`,
            endpointId: twoEnd ? movingEndpoint.id : singleEndpoint.id,
            kind: joint.type === 'prismatic' && joint.motionProfile !== 'rotation-around-origin' ? 'translation' : 'rotation',
            axis: joint.axis,
            plane: joint.motionPlane ?? 'xy',
            limits: {
              lower: joint.limits?.lower ?? -0.8,
              upper: joint.limits?.upper ?? 0.8,
            },
            testValue: 0,
          },
        ]
      : [],
    updatedAt: now,
  };
};

const syncComponentMotionFromGraph = (component: FunctionalComponent | undefined, graph: KinematicGraph | undefined): FunctionalComponent | undefined => {
  if (!component || !graph?.joints.length) return component;
  const joint = graph.joints.find((item) => item.status !== 'rejected') ?? graph.joints[0];
  return {
    ...component,
    mechanicalProperties: {
      ...component.mechanicalProperties,
      movable: joint.type !== 'fixed',
      preferredJointType: joint.type,
    },
    kinematicGraph: graph,
    motionDefinition: motionDefinitionFromJoint(joint),
    metadata: {
      ...component.metadata,
      motionUpdatedAt: new Date().toISOString(),
    },
  };
};

const cleanPartToken = (value: string) =>
  value
    .replace(/\.(glb|fbx|dae|obj|3ds)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();

const inferPartCategory = (assetName: string, objectName: string) => {
  const text = `${assetName} ${objectName}`.toLowerCase();
  if (/audi|car|vehicle|wheel|tire|door|hood|bonnet|trunk|bumper/.test(text)) return 'Vehicles';
  if (/robot|arm|axis|joint|grip|claw|wrist|elbow|shoulder/.test(text)) return 'Robot Arms';
  if (/belt|conveyor|roller|pulley|cinta/.test(text)) return 'Conveyors';
  if (/tree|branch|leaf|trunk/.test(text)) return 'Trees';
  if (/house|wall|door|window|roof/.test(text)) return 'Buildings';
  return 'General Parts';
};

const inferPartClassName = (objectName: string) => {
  const text = objectName.toLowerCase();
  if (/wheel|tire|tyre/.test(text)) return 'Wheel';
  if (/door|hood|bonnet|trunk|panel|cover/.test(text)) return 'Panel';
  if (/axis|joint|pivot|rotating|wrist|elbow|shoulder/.test(text)) return 'Joint';
  if (/arm|forearm|link|beam/.test(text)) return 'Arm Link';
  if (/grip|claw|finger|grasper/.test(text)) return 'End Effector';
  if (/base|frame|body|chassis/.test(text)) return 'Structure';
  if (/belt|roller|pulley/.test(text)) return 'Transmission';
  return 'Component';
};

const makePartCode = (category: string, className: string, index: number) =>
  `${category.slice(0, 3)}-${className.slice(0, 3)}-${String(index + 1).padStart(4, '0')}`.toUpperCase().replace(/[^A-Z0-9-]/g, '');

const cloneGeometry = <T extends GeometryDefinition>(geometry: T): T => JSON.parse(JSON.stringify(geometry)) as T;

const mapKinematicGraphToStoredPart = (
  graph: KinematicGraph,
  mapPoint: (point: Vector3Tuple) => Vector3Tuple,
  mapDirection: (direction: Vector3Tuple) => Vector3Tuple,
): KinematicGraph => ({
  ...graph,
  parts: graph.parts.map((part) => ({
    ...part,
    bounds: { ...part.bounds, center: mapPoint(part.bounds.center) },
  })),
  joints: graph.joints.map((joint) => ({
    ...joint,
    origin: { ...joint.origin, position: mapPoint(joint.origin.position) },
    drivenPoint: joint.drivenPoint ? mapPoint(joint.drivenPoint) : undefined,
    axis: mapDirection(joint.axis),
    axis2: joint.axis2 ? mapDirection(joint.axis2) : undefined,
  })),
});

const cloneStoredNode = (node: SceneNode, index = 0): SceneNode => ({
  ...node,
  id: `node_${crypto.randomUUID().slice(0, 8)}`,
  name: index ? `${node.name} ${index + 1}` : node.name,
  geometry: cloneGeometry(node.geometry),
  material: { ...node.material },
  transform: {
    position: [node.transform.position[0] + index * 0.45, node.transform.position[1], node.transform.position[2] + index * 0.25],
    rotation: [...node.transform.rotation],
    scale: [...node.transform.scale],
  },
  locked: false,
  createdAt: new Date().toISOString(),
});

const cloneWarehouseItemForImport = (item: PartWarehouseItem, index: number): PartWarehouseItem => {
  const now = new Date().toISOString();
  const code = makePartCode(item.category, item.className, index);

  if (item.itemType === 'assembly') {
    return {
      ...item,
      id: `assembly_${crypto.randomUUID().slice(0, 8)}`,
      code,
      assemblyNodes: item.assemblyNodes.map((node, nodeIndex) => cloneStoredNode(node, nodeIndex)),
      metadata: { ...item.metadata, updatedAt: now },
    };
  }

  return {
    ...item,
    id: `part_${crypto.randomUUID().slice(0, 8)}`,
    code,
    geometry: cloneGeometry(item.geometry),
    material: { ...item.material },
    metadata: { ...item.metadata, updatedAt: now },
  };
};

const sceneAssemblyBounds = (nodes: SceneNode[]): [number, number, number] => {
  const importedBounds = nodes
    .map((node) => (node.geometry.kind === 'imported-model' || node.geometry.kind === 'serialized-object' ? node.geometry.normalizedBounds : undefined))
    .filter((bounds): bounds is [number, number, number] => Boolean(bounds));
  if (!importedBounds.length) return [1, 1, 1];
  return importedBounds.reduce<[number, number, number]>(
    (max, bounds) => [Math.max(max[0], bounds[0]), Math.max(max[1], bounds[1]), Math.max(max[2], bounds[2])],
    [0, 0, 0],
  );
};

const functionalComponentId = (sourceAssetName: string, objectName: string) =>
  `component_${sourceAssetName}_${objectName}`.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 72);

const instantiateFunctionalComponent = (component: FunctionalComponent, instanceId: string, transform: Transform): FunctionalComponent => ({
  ...component,
  id: instanceId,
  localTransform: transform,
  interfaces: component.interfaces.map((mechanicalInterface) => ({
    ...mechanicalInterface,
    id: `${mechanicalInterface.id}_${instanceId}`.slice(0, 96),
    componentId: instanceId,
  })),
  metadata: {
    ...component.metadata,
    sourceFunctionalComponentId: component.id,
  },
});

const mergeWarehouseItems = (currentItems: PartWarehouseItem[] = [], incomingItems: PartWarehouseItem[] = []) => {
  const indexByKey = new Map(currentItems.map((item, index) => [warehouseItemKey(item), index]));
  const merged = [...currentItems];
  incomingItems.forEach((item) => {
    const key = warehouseItemKey(item);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push(item);
    } else {
      merged[existingIndex] = item;
    }
  });
  return merged;
};

const formatGigabytes = (bytes: number) => `${(bytes / 1024 / 1024 / 1024).toFixed(3)} GB`;

const functionalWarehouseSummary = (item: PartWarehouseItem) => {
  if (item.itemType === 'assembly' && item.functionalAssembly) {
    return `${item.functionalAssembly.components.length} components | ${item.functionalAssembly.connections.length} joints`;
  }
  if (item.itemType === 'part' && item.functionalComponent) {
    return `${item.functionalComponent.interfaces.length} interfaces | ${item.functionalComponent.mechanicalProperties.role}`;
  }
  return item.itemType === 'assembly' ? `${item.assemblyNodes.length} parts` : item.metadata.sourceFormat.toUpperCase();
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Preview conversion failed.'));
    reader.readAsDataURL(blob);
  });

type WorkspaceContextMenu = ViewportContextMenuEvent & {
  mode?: 'joint' | 'part' | 'object';
};

type JointRangeEditor = {
  nodeId: string;
  jointId: string;
  lower: string;
  upper: string;
  error?: string;
};

type InspectorFocus = 'object' | 'mechanics' | 'parts' | 'twin' | 'export';

type ViewportJointTestMode = 'movement' | 'full-range';
type ViewportInspectionPhase = 'idle' | 'testing' | 'awaiting-confirmation' | 'repairing' | 'complete' | 'stopped';
type ViewportRepairMode = 'root' | 'axis' | 'pivot' | 'type' | 'limits' | 'parent-child' | 'coupling';
type MotionPlane = NonNullable<KinematicJoint['motionPlane']>;

const rotationPlaneForAxis = (axis: [number, number, number]): MotionPlane => {
  const absolute = axis.map(Math.abs);
  if (absolute[0] >= absolute[1] && absolute[0] >= absolute[2]) return 'yz';
  if (absolute[1] >= absolute[0] && absolute[1] >= absolute[2]) return 'xz';
  return 'xy';
};

const defaultPlaneForLinearAxis = (axis: [number, number, number]): MotionPlane => (Math.abs(axis[2]) > Math.abs(axis[0]) && Math.abs(axis[2]) > Math.abs(axis[1]) ? 'xz' : 'xy');

const axisPatchForJoint = (joint: KinematicJoint | undefined, axis: [number, number, number]): Partial<KinematicJoint> => {
  const rotational = !joint || joint.type === 'revolute' || joint.type === 'continuous' || joint.motionProfile === 'rotation-around-origin';
  return {
    axis,
    motionPlane: rotational ? rotationPlaneForAxis(axis) : (joint.motionPlane ?? defaultPlaneForLinearAxis(axis)),
  };
};

const centeredAxisPatchForPiece = (node: SceneNode | undefined, joint: KinematicJoint | undefined, axis: [number, number, number]): Partial<KinematicJoint> => ({
  ...axisPatchForJoint(joint, axis),
  origin: joint?.origin,
});

type ViewportInspectionState = {
  phase: ViewportInspectionPhase;
  nodeId?: string;
  jointId?: string;
  mode?: ViewportJointTestMode;
  sequence?: number[];
  sequenceIndex?: number;
  inspectedJointIds?: string[];
  inspectIndex?: number;
  correctJointIds: string[];
  attentionJointIds: string[];
  skippedJointIds: string[];
  repairMode?: ViewportRepairMode;
  message: string;
};

type PieceAnalysisState = {
  sourceDocument: AssetDocument;
  nodeId: string;
  sourceNodeId?: string;
  sourceObjectName?: string;
};

type PlcDashboardState = {
  open: boolean;
  running: boolean;
  advanced: boolean;
  externalBridgeEnabled: boolean;
  externalBridgeOnline: boolean;
  externalBridgeServerOnline: boolean;
  externalBridgeClientConnected: boolean;
  externalBridgeDisconnectedByUser: boolean;
  externalBridgeUrl: string;
  externalBridgeClientId?: string;
  externalBridgeClientIp?: string;
  externalBridgeClientPort?: string | number;
  externalBridgeLastReceivedAt?: string;
  registerOverrides: Record<string, number>;
  project?: TwinProject;
  frame?: PlcSimulationFrame;
  frameNodeId?: string;
  startedAtMs?: number;
  sequence: number;
  message: string;
  localManualActive: boolean;
  plc: VirtualPlcRuntime;
  iotTelemetry?: {
    valid: boolean;
    temperatureC: number;
    humidityPercent: number;
    gyroDps: number;
    accelX: number;
    accelY: number;
    accelZ: number;
    gyroX: number;
    gyroY: number;
    gyroZ: number;
    magX: number;
    magY: number;
    magZ: number;
    hasAcceleration: boolean;
    hasGyroscope: boolean;
    hasMagnetometer: boolean;
    hasEnvironment: boolean;
    ageMs: number;
    source: string;
    sequence?: number;
    sampleId?: string;
    quality?: string;
    sourceTimestampUtc?: string;
    receivedAtUtc?: string;
    forwardedAt?: string;
  };
  openPlc: {
    endpointProfile: 'openplc' | 's7-1200-robot-holding';
    autoReconnect: boolean;
    connectionAuthorized: boolean;
    controlledNodeId?: string;
    enabled: boolean;
    online: boolean;
    runtimeRunning?: boolean;
    runtimeIssue?: string;
    host: string;
    port: number;
    unitId: number;
    address: number;
    quantity: number;
    dataFormat: 'float32-be' | 'int16-rad-x10000';
    pollMs: number;
    received: number;
    probing: boolean;
    command: 0 | 1 | 2;
    status?: number;
    activeStep?: number;
    elapsedMs?: number;
    alarmCode?: number;
    conditionState?: number;
    speedPermille?: number;
    sensorPolicy?: 0 | 1;
    rawRegisters?: number[];
    diagnostics?: string;
    lastReceivedAt?: string;
    error?: string;
  };
};

type RegisterEncoding = 'uint16' | 'int16' | 'int16-rad-x10000' | 'float32-be';
type RegisterAccess = 'platform-to-plc' | 'plc-to-platform' | 'read-write';
type InternalRegisterDefinition = {
  id: string;
  wire: number;
  semantic: string;
  encoding: RegisterEncoding;
  access: RegisterAccess;
  enabled: boolean;
  role: 'system' | 'joint' | 'custom';
  robotNodeId?: string;
  jointId?: string;
  connectionId?: string;
  protocol?: 'modbus' | 'mqtt' | 'opcua';
  topic?: string;
  valuePath?: string;
  qos?: 0 | 1 | 2;
  opcUaNodeId?: string;
  opcUaBrowsePath?: string;
  scale?: number;
  offset?: number;
  unit?: string;
  pollingMs?: number;
};

const REGISTER_CONFIGURATION_KEY = 'twinaxis.signalMapping.v1';
const LEGACY_REGISTER_CONFIGURATION_KEY = 'assetForge.internalRegisterConfiguration.v1';
const CONNECTION_PROFILES_KEY = 'twinaxis.connectionProfiles.v1';
const PLC_ENDPOINT_KEY = 'twinaxis.plcEndpoint.v1';

type PersistedPlcEndpoint = Pick<PlcDashboardState['openPlc'], 'endpointProfile' | 'host' | 'port' | 'unitId' | 'address' | 'quantity' | 'dataFormat' | 'pollMs' | 'autoReconnect' | 'connectionAuthorized' | 'controlledNodeId'>;

const loadPlcEndpoint = (): Partial<PersistedPlcEndpoint> => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PLC_ENDPOINT_KEY) ?? '{}') as Partial<PersistedPlcEndpoint>;
    if (!parsed || typeof parsed !== 'object') return {};
    if (parsed.endpointProfile !== 'openplc' && parsed.endpointProfile !== 's7-1200-robot-holding') return {};
    return parsed;
  } catch {
    return {};
  }
};

const defaultConnectionProfiles = (): ConnectionProfile[] => [
  { id: 'openplc-main', name: 'OpenPLC Runtime', protocol: 'modbus', endpoint: '127.0.0.1:502', enabled: true, autoReconnect: true, reconnectDelayMs: 1500, metadata: { managedBy: 'openplc-dashboard', unitId: 1 } },
  { id: 'mqtt-main', name: 'MQTT Broker', protocol: 'mqtt', endpoint: 'ws://127.0.0.1:9001', enabled: false, autoReconnect: true, reconnectDelayMs: 1500, metadata: { clientIdPrefix: 'twinaxis' } },
  { id: 'opcua-main', name: 'OPC UA Gateway', protocol: 'opcua', endpoint: 'http://127.0.0.1:8088', enabled: false, autoReconnect: true, reconnectDelayMs: 2000, metadata: { endpointUrl: 'opc.tcp://127.0.0.1:4840', securityPolicy: 'None' } },
];

const loadConnectionProfiles = (): ConnectionProfile[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONNECTION_PROFILES_KEY) ?? '[]') as ConnectionProfile[];
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch { /* Invalid user configuration falls back to documented profiles. */ }
  return defaultConnectionProfiles();
};
const systemRegisterDefinitions = (): InternalRegisterDefinition[] => [
  { id: 'system-command', wire: 90, semantic: 'Robot command', encoding: 'uint16', access: 'platform-to-plc', enabled: true, role: 'system' },
  { id: 'system-status', wire: 91, semantic: 'PLC status', encoding: 'uint16', access: 'plc-to-platform', enabled: true, role: 'system' },
  { id: 'system-step', wire: 92, semantic: 'Active sequence step', encoding: 'uint16', access: 'plc-to-platform', enabled: true, role: 'system' },
  { id: 'system-time', wire: 93, semantic: 'Cycle elapsed time (ms)', encoding: 'uint16', access: 'plc-to-platform', enabled: true, role: 'system' },
  { id: 'system-alarm', wire: 94, semantic: 'Alarm code', encoding: 'uint16', access: 'plc-to-platform', enabled: true, role: 'system' },
  { id: 'system-condition', wire: 95, semantic: 'Condition state', encoding: 'uint16', access: 'plc-to-platform', enabled: true, role: 'system' },
  { id: 'system-speed', wire: 96, semantic: 'Speed permille', encoding: 'uint16', access: 'plc-to-platform', enabled: true, role: 'system' },
  { id: 'iot-temperature', wire: 120, semantic: 'IoT temperature (C x100)', encoding: 'int16', access: 'platform-to-plc', enabled: true, role: 'system' },
  { id: 'iot-humidity', wire: 121, semantic: 'IoT relative humidity (% x100)', encoding: 'uint16', access: 'platform-to-plc', enabled: true, role: 'system' },
  { id: 'iot-gyro', wire: 122, semantic: 'IoT gyroscope magnitude (deg/s x100)', encoding: 'uint16', access: 'platform-to-plc', enabled: true, role: 'system' },
  { id: 'iot-age', wire: 123, semantic: 'IoT sample age (ms)', encoding: 'uint16', access: 'platform-to-plc', enabled: true, role: 'system' },
  { id: 'iot-valid', wire: 124, semantic: 'IoT sample valid', encoding: 'uint16', access: 'platform-to-plc', enabled: true, role: 'system' },
  { id: 'iot-sequence', wire: 125, semantic: 'IoT sample sequence', encoding: 'uint16', access: 'platform-to-plc', enabled: true, role: 'system' },
  { id: 'iot-quality', wire: 126, semantic: 'IoT quality bit field', encoding: 'uint16', access: 'platform-to-plc', enabled: true, role: 'system' },
  { id: 'iot-policy', wire: 127, semantic: 'Sensor policy', encoding: 'uint16', access: 'read-write', enabled: true, role: 'system' },
];

const loadRegisterConfiguration = (): InternalRegisterDefinition[] => {
  try {
    const stored = window.localStorage.getItem(REGISTER_CONFIGURATION_KEY) ?? window.localStorage.getItem(LEGACY_REGISTER_CONFIGURATION_KEY);
    const parsed = JSON.parse(stored ?? '[]') as InternalRegisterDefinition[];
    if (Array.isArray(parsed) && parsed.length) return parsed.filter((item) => Number.isInteger(item.wire) && item.wire >= 0 && item.wire <= 65534);
  } catch { /* Invalid user configuration falls back to the documented map. */ }
  return systemRegisterDefinitions();
};

const registerWordCount = (encoding: RegisterEncoding) => encoding === 'float32-be' ? 2 : 1;
const registerHr = (wire: number) => 40001 + wire;
const mappingScale = (entry: InternalRegisterDefinition) => entry.scale ?? (entry.encoding === 'int16-rad-x10000' ? 0.0001 : 1);
const mappingOffset = (entry: InternalRegisterDefinition) => entry.offset ?? 0;
const mappingPollingMs = (entry: InternalRegisterDefinition) => entry.pollingMs ?? 250;

const defaultModbusBridgeUrl = () => {
  try {
    const stored = window.localStorage.getItem('assetForge.modbusBridgeUrl');
    if (!stored) return 'http://127.0.0.1:8765';
    const parsed = new URL(stored);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'http://127.0.0.1:8765';
    return `${parsed.protocol}//${parsed.hostname || '127.0.0.1'}:${parsed.port || '8765'}`;
  } catch {
    return 'http://127.0.0.1:8765';
  }
};

const normalizeModbusBridgeUrl = (host: string, port: string | number) => {
  const cleanHost = host.trim() || '127.0.0.1';
  const cleanPort = String(port).trim() || '8765';
  return `http://${cleanHost}:${cleanPort}`;
};

const parseModbusBridgeEndpoint = (url: string) => {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || '127.0.0.1',
      port: parsed.port || '8765',
      stateUrl: `${parsed.origin}/state`,
      writeUrl: `${parsed.origin}/write`,
    };
  } catch {
    return {
      host: '127.0.0.1',
      port: '8765',
      stateUrl: 'http://127.0.0.1:8765/state',
      writeUrl: 'http://127.0.0.1:8765/write',
    };
  }
};

export const App = () => {
  const [document, setDocument] = useState<AssetDocument>(loadInitialProject);
  const [past, setPast] = useState<AssetDocument[]>([]);
  const [future, setFuture] = useState<AssetDocument[]>([]);
  const [tool, setTool] = useState<EditorTool>('translate');
  const [partEditMode, setPartEditMode] = useState<PartEditMode>('free');
  const [selectedParts, setSelectedParts] = useState<ImportedPartSelection[]>([]);
  const [warehouseMenu, setWarehouseMenu] = useState<{ itemId: string; x: number; y: number } | undefined>();
  const [workspaceMenu, setWorkspaceMenu] = useState<WorkspaceContextMenu | undefined>();
  const [jointRangeEditor, setJointRangeEditor] = useState<JointRangeEditor | undefined>();
  const [inspectorFocus, setInspectorFocus] = useState<InspectorFocus>('object');
  const [activeView, setActiveView] = useState<'workspace' | 'warehouse'>('workspace');
  const [warehouseQuery, setWarehouseQuery] = useState('');
  const [warehouseTypeFilter, setWarehouseTypeFilter] = useState<'all' | 'part' | 'assembly'>('all');
  const [pendingWorkspaceNodeIds, setPendingWorkspaceNodeIds] = useState<string[]>([]);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [visualStateOverlayEnabled, setVisualStateOverlayEnabled] = useState(true);
  const [historianRecording, setHistorianRecording] = useState(false);
  const [historianRecords, setHistorianRecords] = useState<HistorianRecord[]>([]);
  const [replayFrameIndex, setReplayFrameIndex] = useState(-1);
  const [historianBusy, setHistorianBusy] = useState(false);
  const [alarmRules, setAlarmRules] = useState<AlarmRule[]>(() => loadProjectRuntimeCollection<AlarmRule>(document.metadata.id, 'alarmRules'));
  const [alarmInstances, setAlarmInstances] = useState<AlarmInstance[]>([]);
  const [alarmEvents, setAlarmEvents] = useState<TwinProject['events']>([]);
  const [simulationScenarios, setSimulationScenarios] = useState<SimulationScenario[]>(() => loadProjectRuntimeCollection<SimulationScenario>(document.metadata.id, 'scenarios'));
  const [activeScenarioId, setActiveScenarioId] = useState<string>();
  const [scenarioElapsedMs, setScenarioElapsedMs] = useState(0);
  const [scenarioRunning, setScenarioRunning] = useState(false);
  const scenarioStartedAtRef = useRef<string>();

  useEffect(() => {
    window.localStorage.setItem(`twinaxis.alarmRules.${document.metadata.id}`, JSON.stringify(alarmRules));
  }, [alarmRules, document.metadata.id]);

  useEffect(() => {
    window.localStorage.setItem(`twinaxis.scenarios.${document.metadata.id}`, JSON.stringify(simulationScenarios));
  }, [simulationScenarios, document.metadata.id]);
  const [issues, setIssues] = useState<ValidationIssue[]>(() => validateProject(document));
  const [status, setStatus] = useState('Ready');
  const [modbusControllerLaunching, setModbusControllerLaunching] = useState(false);
  const [modbusControllerDrawerOpen, setModbusControllerDrawerOpen] = useState(false);
  const [traceAuditDrawerOpen, setTraceAuditDrawerOpen] = useState(false);
  const [internalSettingsOpen, setInternalSettingsOpen] = useState(false);
  const [registerConfiguration, setRegisterConfiguration] = useState<InternalRegisterDefinition[]>(loadRegisterConfiguration);
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>(loadConnectionProfiles);
  const [connectionHealth, setConnectionHealth] = useState<Record<string, ConnectionHealth>>({});
  const protocolRegistryRef = useRef(new ProtocolAdapterRegistry());
  const connectionManagerRef = useRef(new TwinAxisConnectionManager(protocolRegistryRef.current));
  const [modbusControllerDrawerWidth, setModbusControllerDrawerWidth] = useState(860);
  const [traceAuditDrawerWidth, setTraceAuditDrawerWidth] = useState(1040);
  const drawerResizeRef = useRef<{ kind: 'iot' | 'audit'; pointerId: number; startX: number; startWidth: number }>();
  const [modbusControllerUrl, setModbusControllerUrl] = useState<string>();
  const [stats, setStats] = useState<ViewportStats>({ fps: 0, objects: document.nodes.length, triangles: 0, cpuPercent: 0 });
  const [autosaveAvailable, setAutosaveAvailable] = useState(false);
  const [exportProfileId, setExportProfileId] = useState<ExportProfileId>('generic-glb');
  const [exportReport, setExportReport] = useState<ExportReport | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [desktopRuntime] = useState(isDesktopRuntime);
  const [nativeProjectPath, setNativeProjectPath] = useState<string | undefined>();
  const [demoMotionNodeId, setDemoMotionNodeId] = useState<string | undefined>();
  const [externalPlcRuntimePose, setExternalPlcRuntimePose] = useState<{
    nodeId: string;
    jointValues: Record<string, number>;
  }>();
  const [industrialCellDemoActive, setIndustrialCellDemoActive] = useState(false);
  const [motionTrainer, setMotionTrainer] = useState<MotionTrainerState | undefined>();
  const [pieceAnalysis, setPieceAnalysis] = useState<PieceAnalysisState | undefined>();
  const [kinematicEditTarget, setKinematicEditTarget] = useState<KinematicEditTarget | undefined>();
  const [robotCursorGuideNodeId, setRobotCursorGuideNodeId] = useState<string | undefined>();
  const [viewportNotice, setViewportNotice] = useState<string | undefined>();
  const [plcDashboard, setPlcDashboard] = useState<PlcDashboardState>({
    open: false,
    running: false,
    advanced: false,
    externalBridgeEnabled: false,
    externalBridgeOnline: false,
    externalBridgeServerOnline: false,
    externalBridgeClientConnected: false,
    externalBridgeDisconnectedByUser: false,
    externalBridgeUrl: defaultModbusBridgeUrl(),
    registerOverrides: {},
    sequence: 0,
    message: 'Select a kinematic robot and start the local Modbus test.',
    localManualActive: false,
    plc: createVirtualPlcRuntime(),
    openPlc: {
      endpointProfile: 'openplc',
      autoReconnect: false,
      connectionAuthorized: false,
      enabled: false,
      online: false,
      host: '127.0.0.1',
      port: 502,
      unitId: 1,
      address: 100,
      quantity: 6,
      dataFormat: 'int16-rad-x10000',
      pollMs: 250,
      received: 0,
      probing: false,
      command: 0,
      sensorPolicy: 0,
    },
  });
  const [viewportInspection, setViewportInspection] = useState<ViewportInspectionState>({
    phase: 'idle',
    correctJointIds: [],
    attentionJointIds: [],
    skippedJointIds: [],
    message: 'Select a joint to inspect it.',
  });
  const [warehouseStorageInfo, setWarehouseStorageInfo] = useState<WarehouseStorageInfo>({ items: 0, usageBytes: 0, quotaBytes: 0, savedItems: [] });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const glbInputRef = useRef<HTMLInputElement | null>(null);
  const warehouseInputRef = useRef<HTMLInputElement | null>(null);
  const twinPackageInputRef = useRef<HTMLInputElement | null>(null);
  const viewportTestTimerRef = useRef<number | undefined>();
  const viewportNoticeTimerRef = useRef<number | undefined>();
  const kinematicEditSnapshotRef = useRef<{ nodeId: string; jointId: string; joint: KinematicJoint } | undefined>();
  const plcDashboardRef = useRef<PlcDashboardState>(plcDashboard);
  const openPlcExecutionProbeRef = useRef<{ command?: number; elapsedMs?: number; lastProgressAt: number }>({ lastProgressAt: Date.now() });
  const pollOpenPlcRef = useRef<() => Promise<void>>(async () => undefined);
  const openPlcPollInFlightRef = useRef(false);
  const iotPlcForwardInFlightRef = useRef(false);
  const physicalPlcIoQueueRef = useRef<Promise<void>>(Promise.resolve());
  const openPlcFailureCountRef = useRef(0);
  const physicalPlcDemoTimerRef = useRef<number | undefined>();
  const physicalPlcDemoWriteInFlightRef = useRef(false);
  const physicalPlcDemoRunIdRef = useRef(0);
  const physicalPlcJogOriginRef = useRef<number[]>();
  const [physicalPlcDemoActive, setPhysicalPlcDemoActive] = useState(false);
  const historianRef = useRef(new IndexedDbTwinHistorian());
  const historianRecordKeysRef = useRef(new Set<string>());
  const plcBridgeDisconnectLockRef = useRef(false);
  const plcBridgeReconnectArmedRef = useRef(false);

  const selectedNode = useMemo(
    () => document.nodes.find((node) => node.id === document.selectedNodeId),
    [document.nodes, document.selectedNodeId],
  );
  useEffect(() => {
    if (!selectedNode) return;
    setInspectorFocus(graphFromGeometry(selectedNode.geometry) ? 'mechanics' : 'object');
  }, [selectedNode?.id]);
  const selectedWarehouseItem = useMemo(
    () => document.partWarehouse?.find((item) => item.id === document.selectedWarehouseItemId),
    [document.partWarehouse, document.selectedWarehouseItemId],
  );
  const enqueuePhysicalPlcIo = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = physicalPlcIoQueueRef.current.then(operation, operation);
    physicalPlcIoQueueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);
  const warehouseGroups = useMemo(() => {
    const groups = new Map<string, Map<string, PartWarehouseItem[]>>();
    const query = warehouseQuery.trim().toLowerCase();
    (document.partWarehouse ?? []).filter((item) => {
      if (warehouseTypeFilter !== 'all' && item.itemType !== warehouseTypeFilter) return false;
      return !query || `${item.code} ${item.name} ${item.category} ${item.className} ${item.sourceAssetName}`.toLowerCase().includes(query);
    }).forEach((item) => {
      const classes = groups.get(item.category) ?? new Map<string, PartWarehouseItem[]>();
      const items = classes.get(item.className) ?? [];
      items.push(item);
      classes.set(item.className, items);
      groups.set(item.category, classes);
    });
    return [...groups.entries()].map(([category, classes]) => ({
      category,
      classes: [...classes.entries()].map(([className, items]) => ({ className, items })),
    }));
  }, [document.partWarehouse, warehouseQuery, warehouseTypeFilter]);
  const selectedPartsForSelectedNode = useMemo(
    () => (selectedNode ? selectedParts.filter((part) => part.nodeId === selectedNode.id) : []),
    [selectedNode, selectedParts],
  );
  const hasIndustrialCellNodes = useMemo(
    () =>
      document.nodes.some(
        (node) =>
          ('generatorId' in node.geometry && node.geometry.generatorId.startsWith('industrial-')) ||
          (('kinematicGraph' in node.geometry &&
            (node.geometry.kinematicGraph?.analysisVersion === 'industrial-scene-rig-1' ||
              node.geometry.kinematicGraph?.analysisVersion === 'conveyor-rig-industrial-scene-1')) ??
            false),
      ),
    [document.nodes],
  );

  const showViewportNotice = (message: string, durationMs = 4200) => {
    window.clearTimeout(viewportNoticeTimerRef.current);
    setViewportNotice(message);
    if (durationMs > 0) {
      viewportNoticeTimerRef.current = window.setTimeout(() => setViewportNotice(undefined), durationMs);
    }
  };
  const activeKinematicEditTarget = useMemo<KinematicEditTarget | undefined>(() => {
    if (!kinematicEditTarget) return undefined;
    const node = document.nodes.find((item) => item.id === kinematicEditTarget.nodeId);
    if (!node) return undefined;
    const graph = graphFromGeometry(node.geometry);
    if (!graph) return undefined;
    const joint = graph.joints.find((item) => item.id === kinematicEditTarget.jointId);
    if (!joint) return undefined;
    const partById = new Map(graph.parts.map((part) => [part.id, part]));
    const childrenByParent = new Map<string, string[]>();
    graph.joints.forEach((item) => {
      childrenByParent.set(item.parentPartId, [...(childrenByParent.get(item.parentPartId) ?? []), item.childPartId]);
    });
    const affectedPartIds = new Set<string>([joint.childPartId]);
    const queue = [...(childrenByParent.get(joint.childPartId) ?? [])];
    while (queue.length) {
      const partId = queue.shift();
      if (!partId || affectedPartIds.has(partId)) continue;
      affectedPartIds.add(partId);
      queue.push(...(childrenByParent.get(partId) ?? []));
    }
    const objectNamesForParts = (partIds: string[]) =>
      partIds.flatMap((partId) => partById.get(partId)?.meshObjectIds ?? []).filter((objectName): objectName is string => Boolean(objectName));
    return {
      ...kinematicEditTarget,
      origin: joint.origin.position,
      orientation: joint.jointFrame?.orientation ?? joint.origin.rotation,
      axis: joint.axis,
      parentObjectNames: objectNamesForParts([joint.parentPartId]),
      childObjectNames: objectNamesForParts([joint.childPartId]),
      affectedObjectNames: objectNamesForParts([...affectedPartIds]),
    };
  }, [document.nodes, kinematicEditTarget]);

  const currentMotionCandidate = useMemo(() => {
    if (!motionTrainer) return undefined;
    return motionTrainer.candidates[motionTrainer.index];
  }, [motionTrainer]);

  const motionTrainingPreview: MotionTrainingPreview | undefined = currentMotionCandidate
    ? {
        nodeId: currentMotionCandidate.nodeId,
        jointName: currentMotionCandidate.jointName,
        motionKind: currentMotionCandidate.motionKind,
        axis: currentMotionCandidate.axis,
        min: currentMotionCandidate.min,
        max: currentMotionCandidate.max,
        amplitude: currentMotionCandidate.amplitude,
      }
    : undefined;

  const trainingProgress = motionTrainer
    ? {
        current: Math.min(motionTrainer.index + 1, motionTrainer.candidates.length),
        total: motionTrainer.candidates.length,
      }
    : undefined;

  const commit = useCallback(
    (nextDocument: AssetDocument, nextStatus = 'Edited') => {
      const updated = touch(nextDocument);
      setPast((items) => [...items.slice(-80), document]);
      setFuture([]);
      setDocument(updated);
      setIssues(validateProject(updated));
      setStatus(nextStatus);
    },
    [document],
  );

  const markWorkspaceNodesPending = useCallback((nodeIds: string[]) => {
    const cleanIds = nodeIds.filter(Boolean);
    if (!cleanIds.length) return;
    setPendingWorkspaceNodeIds((current) => [...new Set([...current, ...cleanIds])]);
  }, []);

  const clearPendingWorkspaceNodes = useCallback((nodeIds: string[]) => {
    const cleanIds = new Set(nodeIds);
    setPendingWorkspaceNodeIds((current) => current.filter((nodeId) => !cleanIds.has(nodeId)));
  }, []);

  const refreshWarehouseStorageInfo = useCallback(async () => {
    try {
      const info = await loadWarehouseStorageInfo(document.metadata.id);
      setWarehouseStorageInfo(info);
      return info;
    } catch {
      const emptyInfo: WarehouseStorageInfo = { items: 0, usageBytes: 0, quotaBytes: 0, savedItems: [] };
      setWarehouseStorageInfo(emptyInfo);
      return emptyInfo;
    }
  }, [document.metadata.id]);

  useEffect(() => {
    try {
      setAutosaveAvailable(Boolean(loadProjectAutosave()));
    } catch {
      setAutosaveAvailable(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveProjectAutosave(document);
      setAutosaveAvailable(true);
    }, 900);

    return () => window.clearTimeout(timer);
  }, [document]);

  useEffect(() => {
    let cancelled = false;
    loadWarehouseItems(document.metadata.id)
      .then((items) => {
        if (cancelled || !items.length) return;
        setDocument((current) => {
          if (current.metadata.id !== document.metadata.id) return current;
          const mergedItems = mergeWarehouseItems(current.partWarehouse ?? [], items);
          if (mergedItems.length === (current.partWarehouse ?? []).length) return current;
          setStatus(`${items.length} permanent warehouse items loaded`);
          return touch({
            ...current,
            partWarehouse: mergedItems,
            selectedWarehouseItemId: current.selectedWarehouseItemId ?? mergedItems[0]?.id,
          });
        });
      })
      .catch(() => {
        if (!cancelled) setStatus('Permanent warehouse unavailable');
      });

    return () => {
      cancelled = true;
    };
  }, [document.metadata.id]);

  useEffect(() => {
    void refreshWarehouseStorageInfo();
  }, [refreshWarehouseStorageInfo]);

  useEffect(() => {
    const runtimeWindow = window as Window & {
      __assetForgeDocument?: AssetDocument;
      __assetForgeSelectedParts?: ImportedPartSelection[];
      __assetForgeCreateLegacyWarehouseItem?: () => boolean;
      __assetForgeSelectFirstTwoKinematicParts?: () => boolean;
    };
    runtimeWindow.__assetForgeDocument = document;
    runtimeWindow.__assetForgeSelectedParts = selectedParts;
    runtimeWindow.__assetForgeSelectFirstTwoKinematicParts = () => {
      const imported = document.nodes.find((node) => node.geometry.kind === 'imported-model');
      if (!imported || imported.geometry.kind !== 'imported-model') return false;
      const graph = graphFromImportedGeometry(imported.geometry);
      const objectNames = graph.parts.flatMap((part) => part.meshObjectIds).filter(Boolean);
      const uniqueNames = [...new Set(objectNames)].slice(0, 2);
      if (uniqueNames.length < 2) return false;
      setTool('parts');
      setPartEditMode('free');
      setDocument((current) => ({ ...current, selectedNodeId: imported.id }));
      setSelectedParts(uniqueNames.map((objectName) => ({ nodeId: imported.id, objectName })));
      setStatus('2 parts selected');
      return true;
    };
    runtimeWindow.__assetForgeCreateLegacyWarehouseItem = () => {
      const imported = document.nodes.find((node) => node.geometry.kind === 'imported-model');
      if (!imported || imported.geometry.kind !== 'imported-model') return false;
      const now = new Date().toISOString();
      const item: PartWarehousePartItem = {
        id: 'legacy_invisible_pivot',
        itemType: 'part',
        code: 'ROB-JOI-LEGACY',
        name: 'Legacy Pivot',
        category: 'Robot Arms',
        className: 'Joint',
        sourceNodeId: imported.id,
        sourceAssetName: imported.geometry.assetName,
        objectName: 'legacy_non_renderable_pivot',
        geometry: {
          ...imported.geometry,
          isolatedObjectNames: ['legacy_non_renderable_pivot'],
          partObjectNames: undefined,
          freePartTransforms: [],
          partMaterials: [],
        },
        material: imported.material,
        metadata: {
          sourceFormat: imported.geometry.sourceFormat,
          originalBounds: imported.geometry.originalBounds,
          storedAt: now,
          updatedAt: now,
        },
      };
      setDocument(touch({ ...document, partWarehouse: [item], selectedWarehouseItemId: item.id }));
      setStatus('Legacy warehouse item created');
      return true;
    };
  }, [document, selectedParts]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT') return;

      const key = event.key.toLowerCase();
      if (key === 'escape') {
        event.preventDefault();
        setWorkspaceMenu(undefined);
        setWarehouseMenu(undefined);
        if (viewportInspection.phase === 'testing') stopViewportJointTest();
        else if (kinematicEditTarget) cancelActiveKinematicEdit();
      } else if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        undo();
      } else if ((event.ctrlKey || event.metaKey) && (key === 'y' || (event.shiftKey && key === 'z'))) {
        event.preventDefault();
        redo();
      } else if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault();
        save();
      } else if (key === 'w') {
        if (tool === 'parts') setPartEditMode('translate');
        else setTool('translate');
      } else if (key === 'e') {
        if (tool === 'parts') setPartEditMode('rotate');
        else setTool('rotate');
      } else if (key === 'r') {
        if (tool === 'parts') setPartEditMode('scale');
        else setTool('scale');
      } else if (key === 'v') {
        setTool('select');
      } else if (key === 'p') {
        setTool('parts');
        setPartEditMode('free');
      } else if (key === 'delete' || key === 'backspace') {
        removeSelected();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const activateTransformTool = (nextTool: Exclude<PartEditMode, 'free'>) => {
    if (tool === 'parts') {
      if (partEditMode === nextTool) {
        setPartEditMode('free');
        setStatus('Free part mode');
        return;
      }
      setPartEditMode(nextTool);
      setStatus(`Part ${nextTool} mode`);
      return;
    }
    if (tool === nextTool) {
      setTool('select');
      setStatus('Mode cleared');
      return;
    }
    setTool(nextTool);
  };

  const togglePartsTool = () => {
    if (tool === 'parts') {
      setTool('select');
      setPartEditMode('free');
      setSelectedParts([]);
      setStatus('Parts mode cleared');
      return;
    }
    setTool('parts');
    setPartEditMode('free');
    setStatus('Parts mode');
  };

  const selectNode = useCallback(
    (nodeId?: string) => {
      setDocument((current) => ({ ...current, selectedNodeId: nodeId }));
      setSelectedParts([]);
      if (!nodeId) {
        setWorkspaceMenu(undefined);
        setKinematicEditTarget(undefined);
        setViewportInspection((current) => ({
          ...current,
          phase: 'idle',
          nodeId: undefined,
          jointId: undefined,
          repairMode: undefined,
          sequence: undefined,
          sequenceIndex: undefined,
          message: 'Selection cleared. Choose another piece or joint.',
        }));
        showViewportNotice('Selection cleared. You can select another piece now.', 2600);
      }
      setStatus(nodeId ? 'Object selected' : 'Selection cleared');
    },
    [],
  );

  const addNode = (node: SceneNode, nextStatus: string) => {
    commit(
      {
        ...document,
        nodes: [...document.nodes, node],
        selectedNodeId: node.id,
      },
      nextStatus,
    );
    markWorkspaceNodesPending([node.id]);
  };

  const addIndustrialScenePack = () => {
    const nodes = createIndustrialScenePackNodes();
    const replacingStarterPlaceholder = document.nodes.length === 1 && isStarterPlaceholderNode(document.nodes[0]);
    commit(
      {
        ...document,
        nodes: replacingStarterPlaceholder ? nodes : [...document.nodes, ...nodes],
        selectedNodeId: nodes[0]?.id,
      },
      'Industrial scene loaded',
    );
    markWorkspaceNodesPending(nodes.map((node) => node.id));
  };

  const addScenarioOneRealCell = () => {
    const nodes = createScenarioOneRealCellNodes();
    const replacingStarterPlaceholder = document.nodes.length === 1 && isStarterPlaceholderNode(document.nodes[0]);
    commit(
      {
        ...document,
        nodes: replacingStarterPlaceholder ? nodes : [...document.nodes, ...nodes],
        selectedNodeId: nodes[0]?.id,
      },
      'Real industrial scene loaded',
    );
    markWorkspaceNodesPending(nodes.map((node) => node.id));
  };

  const addIndustrialSceneModel = (modelId: (typeof industrialSceneModelIds)[number]) => {
    const node = createIndustrialSceneModelNode(modelId);
    const replacingStarterPlaceholder = document.nodes.length === 1 && isStarterPlaceholderNode(document.nodes[0]);
    commit(
      {
        ...document,
        nodes: replacingStarterPlaceholder ? [node] : [...document.nodes, node],
        selectedNodeId: node.id,
      },
      `${node.name} loaded`,
    );
    markWorkspaceNodesPending([node.id]);
  };

  const updateSelectedNode = (updater: (node: SceneNode) => SceneNode, nextStatus = 'Object updated') => {
    if (!selectedNode) return;
    if (selectedNode.locked) {
      setStatus('Object is locked');
      return;
    }
    commit(
      {
        ...document,
        nodes: document.nodes.map((node) => (node.id === selectedNode.id ? updater(node) : node)),
      },
      nextStatus,
    );
    markWorkspaceNodesPending([selectedNode.id]);
  };

  const updateSelectedNodeLive = (updater: (node: SceneNode) => SceneNode, nextStatus = 'Object updated') => {
    if (!selectedNode) return;
    if (selectedNode.locked) {
      setStatus('Object is locked');
      return;
    }

    const selectedNodeId = selectedNode.id;
    setDocument((current) =>
      touch({
        ...current,
        nodes: current.nodes.map((node) => (node.id === selectedNodeId ? updater(node) : node)),
      }),
    );
    markWorkspaceNodesPending([selectedNodeId]);
    setStatus(nextStatus);
  };

  const finishOrAdvanceMotionTrainer = (statusWhenComplete = 'Motion tests complete') => {
    setMotionTrainer((current) => {
      if (!current) return undefined;
      const nextIndex = current.index + 1;
      if (nextIndex >= current.candidates.length) {
        setStatus(statusWhenComplete);
        return undefined;
      }
      return { ...current, index: nextIndex };
    });
  };

  const startMotionTrainer = () => {
    if (!selectedNode || selectedNode.geometry.kind !== 'imported-model' || !selectedNode.geometry.joints.length) return;
    const candidates = makeMotionTrainingCandidates(selectedNode);
    setDemoMotionNodeId(undefined);
    setMotionTrainer({ nodeId: selectedNode.id, candidates, index: 0 });
    setStatus(`Motion tests started (${candidates.length})`);
  };

  const stopMotionTrainer = () => {
    setMotionTrainer(undefined);
    setStatus('Motion tests stopped');
  };

  const acceptMotionTest = () => {
    const candidate = currentMotionCandidate;
    if (!candidate) return;

    const nextDocument = touch({
      ...document,
      nodes: document.nodes.map((node) => {
        if (node.id !== candidate.nodeId || node.geometry.kind !== 'imported-model') return node;
        const existing = node.geometry.validatedMotions ?? [];
        const duplicate = existing.some(
          (motion) => motion.jointName === candidate.jointName && motion.motionKind === candidate.motionKind && motion.axis === candidate.axis,
        );
        if (duplicate) return node;

        const nextMotion: ValidatedJointMotion = {
          id: `motion_${crypto.randomUUID().slice(0, 8)}`,
          jointName: candidate.jointName,
          label: candidate.label,
          motionKind: candidate.motionKind,
          axis: candidate.axis,
          min: candidate.min,
          max: candidate.max,
          amplitude: candidate.amplitude,
          order: existing.length,
        };

        return {
          ...node,
          geometry: {
            ...node.geometry,
            validatedMotions: [...existing, nextMotion],
          },
        };
      }),
    });

    setPast((items) => [...items.slice(-80), document]);
    setFuture([]);
    setDocument(nextDocument);
    setIssues(validateProject(nextDocument));
    finishOrAdvanceMotionTrainer('Motion tests complete');
    setStatus('Motion test validated');
  };

  const rejectMotionTest = () => {
    finishOrAdvanceMotionTrainer('Motion tests complete');
    setStatus('Motion test rejected');
  };

  const updateValidatedMotions = (nodeId: string, updater: (motions: ValidatedJointMotion[]) => ValidatedJointMotion[], nextStatus: string) => {
    const nextDocument = touch({
      ...document,
      nodes: document.nodes.map((node) => {
        if (node.id !== nodeId || node.geometry.kind !== 'imported-model') return node;
        const ordered = [...(node.geometry.validatedMotions ?? [])].sort((a, b) => a.order - b.order);
        const nextMotions = updater(ordered).map((motion, index) => ({ ...motion, order: index }));
        return {
          ...node,
          geometry: {
            ...node.geometry,
            validatedMotions: nextMotions,
          },
        };
      }),
    });
    commit(nextDocument, nextStatus);
  };

  const moveValidatedMotion = (nodeId: string, motionId: string, direction: -1 | 1) => {
    updateValidatedMotions(
      nodeId,
      (motions) => {
        const index = motions.findIndex((motion) => motion.id === motionId);
        const targetIndex = index + direction;
        if (index < 0 || targetIndex < 0 || targetIndex >= motions.length) return motions;
        const next = [...motions];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        return next;
      },
      'Motion order updated',
    );
  };

  const removeValidatedMotion = (nodeId: string, motionId: string) => {
    updateValidatedMotions(nodeId, (motions) => motions.filter((motion) => motion.id !== motionId), 'Motion removed');
  };

  const updateNodeTransform = useCallback(
    (nodeId: string, transform: Transform) => {
      const target = document.nodes.find((node) => node.id === nodeId);
      if (target?.locked) {
        setStatus('Object is locked');
        return;
      }

      commit(
        {
          ...document,
          nodes: document.nodes.map((node) => (node.id === nodeId ? { ...node, transform } : node)),
        },
        'Transform committed',
      );
      markWorkspaceNodesPending([nodeId]);
    },
    [commit, document, markWorkspaceNodesPending],
  );

  const updateImportedPartTransforms = useCallback(
    (updates: Array<{ nodeId: string; objectName: string; transform: Transform }>) => {
      if (!updates.length) return;
      const lockedTarget = updates.some((update) => document.nodes.find((node) => node.id === update.nodeId)?.locked);
      if (lockedTarget) {
        setStatus('Object is locked');
        return;
      }
      const updatesByNode = new Map<string, Array<{ objectName: string; transform: Transform }>>();
      updates.forEach((update) => {
        const items = updatesByNode.get(update.nodeId) ?? [];
        items.push({ objectName: update.objectName, transform: update.transform });
        updatesByNode.set(update.nodeId, items);
      });

      commit(
        {
          ...document,
          nodes: document.nodes.map((node) => {
            const nodeUpdates = updatesByNode.get(node.id);
            if (!nodeUpdates || node.geometry.kind !== 'imported-model') return node;
            const existing = node.geometry.freePartTransforms ?? [];
            const transformByName = new Map(existing.map((partTransform) => [partTransform.objectName, partTransform]));
            nodeUpdates.forEach((update) => {
              transformByName.set(update.objectName, {
                objectName: update.objectName,
                position: update.transform.position,
                rotation: update.transform.rotation,
                scale: update.transform.scale,
              });
            });

            return {
              ...node,
              geometry: {
                ...node.geometry,
                freePartTransforms: [...transformByName.values()],
              },
            };
          }),
        },
        updates.length === 1 ? 'Part moved' : 'Parts moved',
      );
      markWorkspaceNodesPending([...updatesByNode.keys()]);
    },
    [commit, document, markWorkspaceNodesPending],
  );

  const updatePartSelectionStatus = useCallback((selection: ImportedPartSelection[]) => {
    setSelectedParts(selection);
    const count = selection.length;
    if (!count) {
      if (tool === 'parts') setStatus('Part selection cleared');
      return;
    }
    setStatus(count === 1 ? '1 part selected' : `${count} parts selected`);
  }, [tool]);

  const updateSelectedPartColor = useCallback(
    (color: string) => {
      if (!selectedParts.length) return;
      const selectedByNode = new Map<string, Set<string>>();
      selectedParts.forEach((part) => {
        const names = selectedByNode.get(part.nodeId) ?? new Set<string>();
        names.add(part.objectName);
        selectedByNode.set(part.nodeId, names);
      });

      commit(
        {
          ...document,
          nodes: document.nodes.map((node) => {
            const names = selectedByNode.get(node.id);
            if (!names || node.geometry.kind !== 'imported-model') return node;
            const materialByName = new Map((node.geometry.partMaterials ?? []).map((partMaterial) => [partMaterial.objectName, partMaterial]));
            names.forEach((objectName) => {
              materialByName.set(objectName, {
                objectName,
                color,
                roughness: node.material.roughness,
                metalness: node.material.metalness,
              });
            });
            return {
              ...node,
              geometry: {
                ...node.geometry,
                partMaterials: [...materialByName.values()],
              },
            };
          }),
        },
        selectedParts.length === 1 ? 'Part color updated' : 'Part colors updated',
      );
      markWorkspaceNodesPending([...selectedByNode.keys()]);
    },
    [commit, document, markWorkspaceNodesPending, selectedParts],
  );

  const buildWarehouseItem = async (node: SceneNode, objectName: string, index: number): Promise<PartWarehousePartItem | undefined> => {
    if (node.geometry.kind !== 'imported-model') return undefined;
    const category = inferPartCategory(node.geometry.assetName, objectName);
    const className = inferPartClassName(objectName);
    const now = new Date().toISOString();
    const independentPart = await createIndependentWarehousePartGeometry(node.geometry, node.material, objectName);
    const independentGeometry = independentPart.geometry;
    const componentId = functionalComponentId(node.geometry.assetName, objectName);
    const cleanComponentGraph = createStandalonePieceGraph(componentId, cleanPartToken(objectName), objectName, independentGeometry.normalizedBounds);
    const preservePieceMotion = Boolean(node.geometry.isIsolatedFunctionalComponent || node.geometry.functionalComponent?.motionDefinition);
    const componentGraph =
      preservePieceMotion && node.geometry.kinematicGraph
        ? mapKinematicGraphToStoredPart(node.geometry.kinematicGraph, independentPart.sourcePointToStoredPoint, independentPart.sourceDirectionToStoredDirection)
        : cleanComponentGraph;
    const baseComponent =
      preservePieceMotion && node.geometry.functionalComponent
        ? node.geometry.functionalComponent
        : buildFunctionalComponent({
            id: componentId,
            name: cleanPartToken(objectName),
            category,
            className,
            sourceAssetName: node.geometry.assetName,
            sourceObjectName: objectName,
            bounds: independentGeometry.originalBounds,
            material: { ...node.material },
          });
    const storedReferenceCenter = node.geometry.pieceReferenceCenter
      ? { ...node.geometry.pieceReferenceCenter, position: independentPart.sourcePointToStoredPoint(node.geometry.pieceReferenceCenter.position) }
      : undefined;
    const syncedComponent = syncComponentMotionFromGraph(baseComponent, componentGraph);
    const functionalComponent =
      syncedComponent && storedReferenceCenter
        ? {
            ...syncedComponent,
            origin: { ...syncedComponent.origin, position: storedReferenceCenter.position },
            bounds: { ...syncedComponent.bounds, center: storedReferenceCenter.position },
            metadata: { ...syncedComponent.metadata, pieceReferenceCenter: storedReferenceCenter },
          }
        : syncedComponent;
    const geometryWithMotion = {
      ...independentGeometry,
      pieceReferenceCenter: storedReferenceCenter,
      kinematicGraph: componentGraph,
      kinematicState: node.geometry.kinematicState ?? createHomeKinematicState(componentGraph),
      functionalComponent,
    };
    const item: PartWarehousePartItem = {
      id: `part_${crypto.randomUUID().slice(0, 8)}`,
      itemType: 'part',
      code: makePartCode(category, className, (document.partWarehouse?.length ?? 0) + index),
      name: cleanPartToken(objectName),
      category,
      className,
      sourceNodeId: node.id,
      sourceAssetName: node.geometry.assetName,
      objectName,
      geometry: geometryWithMotion,
      material: { ...node.material },
      functionalComponent,
      metadata: {
        sourceFormat: independentGeometry.kind,
        originalBounds: independentGeometry.originalBounds,
        storedAt: now,
        updatedAt: now,
      },
    };
    try {
      const previewNode: SceneNode = {
        id: `preview_${item.id}`,
        name: item.name,
        geometry: cloneGeometry(item.geometry),
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        material: { ...item.material },
        visible: true,
        locked: false,
        createdAt: now,
      };
      const previewDocument: AssetDocument = {
        ...document,
        nodes: [previewNode],
        selectedNodeId: previewNode.id,
      };
      item.thumbnailDataUrl = await blobToDataUrl(await renderDocumentPreview(previewDocument, 180));
    } catch {
      item.thumbnailDataUrl = undefined;
    }
    return item;
  };

  const buildStoredScenePartItem = async (node: SceneNode, index: number): Promise<PartWarehousePartItem | undefined> => {
    if (node.geometry.kind !== 'serialized-object') return undefined;
    const category = inferPartCategory(node.name, node.name);
    const className = inferPartClassName(node.name);
    const now = new Date().toISOString();
    const componentId = functionalComponentId(node.geometry.assetName, node.name);
    const componentGraph = node.geometry.kinematicGraph ?? createStandalonePieceGraph(componentId, node.name, node.name, node.geometry.normalizedBounds);
    const baseComponent =
      node.geometry.functionalComponent ??
      buildFunctionalComponent({
        id: componentId,
        name: node.name,
        category,
        className,
        sourceAssetName: node.geometry.assetName,
        sourceObjectName: node.name,
        bounds: node.geometry.originalBounds,
        material: { ...node.material },
        localTransform: node.transform,
      });
    const functionalComponent = syncComponentMotionFromGraph(baseComponent, componentGraph);
    const item: PartWarehousePartItem = {
      id: `part_${crypto.randomUUID().slice(0, 8)}`,
      itemType: 'part',
      code: makePartCode(category, className, (document.partWarehouse?.length ?? 0) + index),
      name: node.name,
      category,
      className,
      sourceNodeId: node.id,
      sourceAssetName: node.geometry.assetName,
      objectName: node.name,
      geometry: {
        ...cloneGeometry(node.geometry),
        kinematicGraph: componentGraph,
        kinematicState: node.geometry.kinematicState ?? createHomeKinematicState(componentGraph),
        functionalComponent,
      },
      material: { ...node.material },
      functionalComponent,
      metadata: {
        sourceFormat: 'serialized-object',
        originalBounds: node.geometry.originalBounds,
        storedAt: now,
        updatedAt: now,
      },
    };
    try {
      const previewNode: SceneNode = {
        ...node,
        id: `preview_${item.id}`,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
      };
      const previewDocument: AssetDocument = {
        ...document,
        nodes: [previewNode],
        selectedNodeId: previewNode.id,
      };
      item.thumbnailDataUrl = await blobToDataUrl(await renderDocumentPreview(previewDocument, 180));
    } catch {
      item.thumbnailDataUrl = undefined;
    }
    return item;
  };

  const storePartsInWarehouse = async (mode: 'selected' | 'all') => {
    if (!selectedNode || selectedNode.geometry.kind !== 'imported-model') return;
    const objectNames =
      mode === 'selected'
        ? selectedParts.filter((part) => part.nodeId === selectedNode.id).map((part) => part.objectName)
        : selectedNode.geometry.partObjectNames?.length
          ? selectedNode.geometry.partObjectNames
          : selectedNode.geometry.joints.map((joint) => joint.name);
    const uniqueObjectNames = [...new Set(objectNames)].filter(Boolean);
    if (!uniqueObjectNames.length) {
      setStatus(mode === 'selected' ? 'Select parts first' : 'No parts detected');
      return;
    }

    const nextItems: PartWarehousePartItem[] = [];
    for (const [index, objectName] of uniqueObjectNames.entries()) {
      setStatus(`Storing part ${index + 1}/${uniqueObjectNames.length}`);
      try {
        const item = await buildWarehouseItem(selectedNode, objectName, index);
        if (item) nextItems.push(item);
      } catch {
        continue;
      }
    }

    if (!nextItems.length) {
      setStatus('No visible parts stored');
      return;
    }

    commit(
      {
        ...document,
        partWarehouse: [...(document.partWarehouse ?? []), ...nextItems],
        selectedWarehouseItemId: nextItems[0]?.id ?? document.selectedWarehouseItemId,
      },
      nextItems.length === 1 ? 'Part stored' : `${nextItems.length} parts stored`,
    );
  };

  const selectWarehouseItem = (itemId: string) => {
    setDocument((current) => ({ ...current, selectedWarehouseItemId: itemId }));
    setStatus('Warehouse part selected');
  };

  const replaceWarehouseItem = (itemId: string, updater: (item: PartWarehouseItem) => PartWarehouseItem, message: string) => {
    const next = touch({
      ...document,
      partWarehouse: (document.partWarehouse ?? []).map((item) => item.id === itemId ? updater(item) : item),
    });
    setPast((items) => [...items, document]);
    setFuture([]);
    setDocument(next);
    setIssues(validateProject(next));
    setStatus(message);
  };

  const updateSelectedFunctionalComponent = (patch: Partial<FunctionalComponent>) => {
    if (!selectedWarehouseItem || selectedWarehouseItem.itemType !== 'part' || !selectedWarehouseItem.functionalComponent) return;
    replaceWarehouseItem(selectedWarehouseItem.id, (item) => item.itemType !== 'part' || !item.functionalComponent ? item : {
      ...item,
      name: typeof patch.name === 'string' ? patch.name : item.name,
      category: typeof patch.category === 'string' ? patch.category : item.category,
      className: typeof patch.className === 'string' ? patch.className : item.className,
      functionalComponent: { ...item.functionalComponent, ...patch, metadata: { ...item.functionalComponent.metadata, updatedAt: new Date().toISOString() } },
      metadata: { ...item.metadata, updatedAt: new Date().toISOString() },
    }, 'Functional component updated');
  };

  const updateSelectedMechanicalInterface = (interfaceId: string, patch: Partial<FunctionalComponent['interfaces'][number]>) => {
    if (!selectedWarehouseItem || selectedWarehouseItem.itemType !== 'part' || !selectedWarehouseItem.functionalComponent) return;
    updateSelectedFunctionalComponent({
      interfaces: selectedWarehouseItem.functionalComponent.interfaces.map((item) => item.id === interfaceId ? { ...item, ...patch } : item),
    });
  };

  const updateSelectedAssemblyConnection = (connectionId: string, updater: (connection: AssemblyConnection) => AssemblyConnection) => {
    if (!selectedWarehouseItem || selectedWarehouseItem.itemType !== 'assembly' || !selectedWarehouseItem.functionalAssembly) return;
    replaceWarehouseItem(selectedWarehouseItem.id, (item) => {
      if (item.itemType !== 'assembly' || !item.functionalAssembly) return item;
      const connections = item.functionalAssembly.connections.map((connection) => connection.id === connectionId ? updater(connection) : connection);
      const kinematicGraph = { ...item.functionalAssembly.kinematicGraph, joints: connections.filter((connection) => connection.status !== 'rejected').map((connection) => connection.joint) };
      const draft = { ...item.functionalAssembly, connections, kinematicGraph };
      const validation = validateFunctionalAssembly(draft);
      return {
        ...item,
        functionalAssembly: {
          ...draft,
          metadata: {
            ...draft.metadata,
            updatedAt: new Date().toISOString(),
            validationStatus: validation.some((issue) => issue.severity === 'error') ? 'invalid' : validation.some((issue) => issue.severity === 'warning') ? 'warning' : 'valid',
            validationMessages: validation.map((issue) => `${issue.code}: ${issue.message}`),
          },
        },
        metadata: { ...item.metadata, updatedAt: new Date().toISOString() },
      };
    }, 'Assembly connection updated');
  };

  const loadPermanentWarehouseIntoProject = async () => {
    setStatus('Loading saved warehouse...');
    try {
      const source = await loadWarehouseItemsWithFallback(document.metadata.id);
      const items = await ensureWarehouseThumbnails(source.items);
      if (!items.length) {
        setStatus('No saved warehouse objects for this project');
        refreshWarehouseStorageInfo();
        return;
      }

      const currentItems = document.partWarehouse ?? [];
      const mergedItems = mergeWarehouseItems(currentItems, items);
      const added = mergedItems.length - currentItems.length;
      const nextDocument = {
        ...document,
        metadata: source.fallback
          ? {
              ...document.metadata,
              id: source.projectId,
              updatedAt: new Date().toISOString(),
            }
          : document.metadata,
        partWarehouse: mergedItems,
        selectedWarehouseItemId: document.selectedWarehouseItemId ?? mergedItems[0]?.id,
      };
      commit(
        nextDocument,
        source.fallback
          ? `${items.length} saved objects loaded from ${source.projectId}`
          : added
            ? `${added} saved objects loaded`
            : 'Saved warehouse already loaded',
      );
      const storageInfo = await loadWarehouseStorageInfo(source.projectId);
      setWarehouseStorageInfo(storageInfo);
    } catch {
      setStatus('Saved warehouse load failed');
    }
  };

  const warehouseScenePosition = (offset = 0): [number, number, number] => {
    const warehouseNodes = document.nodes.filter(
      (node) => node.geometry.kind === 'serialized-object' || (node.geometry.kind === 'imported-model' && node.geometry.sourceFormat === 'glb'),
    ).length + offset;
    return [1.35 + (warehouseNodes % 3) * 0.75, 0, -0.75 + Math.floor(warehouseNodes / 3) * 0.55];
  };

  const buildWarehouseSceneNodes = async (item: PartWarehouseItem, offset = 0): Promise<SceneNode[]> => {
    if (item.itemType === 'assembly') {
      return item.assemblyNodes.map((node, index) => cloneStoredNode(node, offset + index));
    }

    let geometry = cloneGeometry(item.geometry);
    const sourceGraph = item.itemType === 'part' ? item.functionalComponent?.kinematicGraph ?? item.geometry.kinematicGraph : undefined;
    const sourceState = item.itemType === 'part' ? item.geometry.kinematicState ?? (sourceGraph ? createHomeKinematicState(sourceGraph) : undefined) : undefined;
    if (geometry.kind === 'imported-model') {
      setStatus('Preparing stored part for scene...');
      try {
        geometry = (await createIndependentWarehousePartGeometry(geometry, item.material, item.objectName)).geometry;
      } catch {
        setStatus('Stored part has no visible geometry');
        return [];
      }
    }
    if (item.itemType === 'part' && geometry.kind === 'serialized-object') {
      geometry = {
        ...geometry,
        kinematicGraph: sourceGraph,
        kinematicState: sourceState,
        functionalComponent: item.functionalComponent,
      };
    }

    return [
      {
        id: `node_${crypto.randomUUID().slice(0, 8)}`,
        name: item.name,
        geometry,
        transform: {
          position: warehouseScenePosition(offset),
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        material: { ...item.material },
        visible: true,
        locked: false,
        createdAt: new Date().toISOString(),
      },
    ];
  };

  const renderWarehouseItemThumbnail = async (item: PartWarehouseItem) => {
    const nodes = await buildWarehouseSceneNodes(item);
    if (!nodes.length) return undefined;
    const thumbnailDocument: AssetDocument = {
      ...document,
      nodes,
      selectedNodeId: nodes[0]?.id,
    };
    return blobToDataUrl(await renderDocumentPreview(thumbnailDocument, 180));
  };

  const ensureWarehouseThumbnails = useCallback(
    async (items: PartWarehouseItem[]) => {
      const missingItems = items.filter((item) => !item.thumbnailDataUrl);
      if (!missingItems.length) return items;

      const thumbnailById = new Map<string, string>();
      for (const item of missingItems) {
        try {
          const thumbnail = await renderWarehouseItemThumbnail(item);
          if (thumbnail) {
            thumbnailById.set(item.id, thumbnail);
            void saveWarehouseThumbnail(document.metadata.id, item, thumbnail).catch(() => undefined);
          }
        } catch {
          // Keep the item usable even if its preview cannot be rendered.
        }
      }

      if (!thumbnailById.size) return items;
      return items.map((item) => (thumbnailById.has(item.id) ? { ...item, thumbnailDataUrl: thumbnailById.get(item.id) } : item));
    },
    [document],
  );

  useEffect(() => {
    const currentItems = document.partWarehouse ?? [];
    if (!currentItems.some((item) => !item.thumbnailDataUrl)) return;

    let cancelled = false;
    void ensureWarehouseThumbnails(currentItems).then((itemsWithThumbnails) => {
      if (cancelled || !itemsWithThumbnails.some((item) => item.thumbnailDataUrl)) return;
      setDocument((current) => ({
        ...current,
        partWarehouse: (current.partWarehouse ?? []).map((item) => {
          const hydrated = itemsWithThumbnails.find((candidate) => candidate.id === item.id);
          return hydrated?.thumbnailDataUrl && !item.thumbnailDataUrl ? { ...item, thumbnailDataUrl: hydrated.thumbnailDataUrl } : item;
        }),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [document.partWarehouse, ensureWarehouseThumbnails]);

  const importFirstPermanentWarehouseObject = async () => {
    setActiveView('workspace');
    setStatus('Importing saved warehouse object...');
    try {
      const source = await loadWarehouseItemsWithFallback(document.metadata.id);
      const items = await ensureWarehouseThumbnails(source.items);
      const item = items[0];
      if (!item) {
        setStatus('No saved warehouse objects for this project');
        return;
      }

      const nodes = await buildWarehouseSceneNodes(item);
      if (!nodes.length) return;
      commit(
        {
          ...document,
          metadata: source.fallback
            ? {
                ...document.metadata,
                id: source.projectId,
                updatedAt: new Date().toISOString(),
              }
            : document.metadata,
          partWarehouse: mergeWarehouseItems(document.partWarehouse ?? [], items),
          nodes: [...document.nodes, ...nodes],
          selectedNodeId: nodes[0]?.id ?? document.selectedNodeId,
        },
        source.fallback ? `Saved object imported from ${source.projectId}` : 'Saved object imported',
      );
      const storageInfo = await loadWarehouseStorageInfo(source.projectId);
      setWarehouseStorageInfo(storageInfo);
    } catch {
      setStatus('Saved object import failed');
    }
  };

  const addWarehouseItemToScene = async (item: PartWarehouseItem) => {
    setWarehouseMenu(undefined);
    setActiveView('workspace');
    const nodes = await buildWarehouseSceneNodes(item);
    if (!nodes.length) return;
    commit(
      {
        ...document,
        nodes: [...document.nodes, ...nodes],
        selectedNodeId: nodes[0]?.id ?? document.selectedNodeId,
      },
      item.itemType === 'assembly' ? 'Warehouse assembly added' : 'Warehouse part added',
    );
  };

  const addAllWarehouseItemsToScene = async () => {
    const items = document.partWarehouse ?? [];
    if (!items.length) {
      setStatus('No warehouse objects to import');
      return;
    }

    setActiveView('workspace');
    setStatus('Importing saved objects...');
    const nodes: SceneNode[] = [];
    for (const item of items) {
      nodes.push(...(await buildWarehouseSceneNodes(item, nodes.length)));
    }
    if (!nodes.length) return;
    commit(
      {
        ...document,
        nodes: [...document.nodes, ...nodes],
        selectedNodeId: nodes[0]?.id ?? document.selectedNodeId,
      },
      `${nodes.length} warehouse objects imported`,
    );
  };

  const deleteWarehouseItem = (itemId: string) => {
    const itemToDelete = document.partWarehouse?.find((item) => item.id === itemId);
    commit(
      {
        ...document,
        partWarehouse: (document.partWarehouse ?? []).filter((item) => item.id !== itemId),
        selectedWarehouseItemId: document.selectedWarehouseItemId === itemId ? undefined : document.selectedWarehouseItemId,
      },
      'Warehouse item deleted',
    );
    if (itemToDelete) {
      deletePersistentWarehouseItem(document.metadata.id, itemToDelete)
        .then(() => void refreshWarehouseStorageInfo())
        .catch(() => setStatus('Warehouse item deleted locally'));
    }
    setWarehouseMenu(undefined);
  };

  const warehouseItemForWorkspaceNode = (node: SceneNode) =>
    (document.partWarehouse ?? []).find((item) => {
      if (item.metadata.storageKey === `workspace-${node.id}`) return true;
      if (item.itemType === 'part' && node.geometry.kind === 'imported-model' && item.metadata.storageFileName === node.geometry.assetName) return true;
      if (item.itemType === 'part' && node.geometry.kind === 'serialized-object' && item.name === node.name) return true;
      if (item.itemType === 'assembly' && item.name === node.name) return true;
      return false;
    });

  const deleteWorkspaceObjectPermanent = async (nodeId: string) => {
    const node = document.nodes.find((item) => item.id === nodeId);
    if (!node) {
      setStatus('Scene object not found');
      return;
    }
    if (node.locked) {
      setStatus('Object is locked');
      return;
    }

    const warehouseItem = warehouseItemForWorkspaceNode(node);
    commit(
      {
        ...document,
        nodes: document.nodes.filter((item) => item.id !== nodeId),
        selectedNodeId: document.selectedNodeId === nodeId ? undefined : document.selectedNodeId,
        partWarehouse: warehouseItem ? (document.partWarehouse ?? []).filter((item) => item.id !== warehouseItem.id) : document.partWarehouse,
        selectedWarehouseItemId: warehouseItem && document.selectedWarehouseItemId === warehouseItem.id ? undefined : document.selectedWarehouseItemId,
      },
      warehouseItem ? 'Workspace object deleted permanently' : 'Workspace object deleted',
    );
    clearPendingWorkspaceNodes([nodeId]);
    setWorkspaceMenu(undefined);

    if (warehouseItem) {
      await deletePersistentWarehouseItem(document.metadata.id, warehouseItem).catch(() => undefined);
      await refreshWarehouseStorageInfo();
    }
  };

  const saveWarehouseItemsPermanent = async (items: PartWarehouseItem[], label: string) => {
    if (!items.length) {
      setStatus('No warehouse items to save');
      return;
    }

    setStatus(`Saving ${label} to permanent warehouse...`);
    try {
      let result = { saved: 0, skipped: 0 };
      for (const item of items) {
        const nodes = await buildWarehouseSceneNodes(item);
        if (!nodes.length) continue;
        const glb = await exportDocumentAsGlb({
          ...document,
          nodes,
          selectedNodeId: nodes[0]?.id,
        });
        const saved = await saveWarehouseGlbItem(document.metadata.id, item, glb, { overwrite: Boolean(item.metadata.storageKey) });
        result = {
          saved: result.saved + saved.saved,
          skipped: result.skipped + saved.skipped,
        };
      }
      await refreshWarehouseStorageInfo();
      if (result.saved) {
        setStatus(`${result.saved} saved permanently${result.skipped ? `, ${result.skipped} already saved` : ''}`);
      } else {
        setStatus(`${result.skipped} already saved`);
      }
    } catch {
      setStatus('Permanent warehouse save failed');
    }
  };

  const saveSelectedWarehousePermanent = () => {
    if (!selectedWarehouseItem) {
      setStatus('Select a warehouse item first');
      return;
    }
    void saveWarehouseItemsPermanent([selectedWarehouseItem], 'selected item');
  };

  const saveAllWarehousePermanent = () => {
    void saveWarehouseItemsPermanent(document.partWarehouse ?? [], 'all items');
  };

  const exportWarehouseProject = () => {
    const items = warehouseStorageInfo.savedItems;
    if (!items.length) {
      setStatus('Warehouse is empty');
      return;
    }
    const payload = {
      schemaVersion: 1,
      kind: '3d-asset-forge.warehouse-manifest',
      exportedAt: new Date().toISOString(),
      project: {
        id: document.metadata.id,
        name: document.metadata.name,
      },
      storage: {
        directory: `project-warehouse/${document.metadata.id}`,
        usageBytes: warehouseStorageInfo.usageBytes,
      },
      items,
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${document.metadata.name.replace(/\s+/g, '-').toLowerCase()}-warehouse.json`);
    setStatus('Warehouse manifest exported');
  };

  const importWarehouseProject = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as { kind?: string; items?: PartWarehouseItem[] };
        if (parsed.kind !== '3d-asset-forge.warehouse' || !Array.isArray(parsed.items)) {
          throw new Error('Invalid warehouse file.');
        }
        const importedItems = parsed.items.map((item, index) => cloneWarehouseItemForImport(item, (document.partWarehouse?.length ?? 0) + index));
        commit(
          {
            ...document,
            partWarehouse: [...(document.partWarehouse ?? []), ...importedItems],
            selectedWarehouseItemId: importedItems[0]?.id ?? document.selectedWarehouseItemId,
          },
          `${importedItems.length} warehouse items imported`,
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Warehouse import failed');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const storableSceneNodes = () => document.nodes.filter((node) => node.geometry.kind === 'imported-model' || node.geometry.kind === 'serialized-object');

  const storeScenePartsSeparately = async () => {
    const sceneNodes = storableSceneNodes();
    const pendingParts = sceneNodes.flatMap((node) => {
        if (node.geometry.kind === 'serialized-object') return [{ node, objectName: node.name, index: 0 }];
        if (node.geometry.kind !== 'imported-model') return [];
        const names = node.geometry.isolatedObjectNames?.length
          ? node.geometry.isolatedObjectNames
          : node.geometry.partObjectNames?.length
            ? node.geometry.partObjectNames
            : node.geometry.joints.map((joint) => joint.name);
        return [...new Set(names)].map((objectName, index) => ({ node, objectName, index }));
      });
    const nextItems: PartWarehousePartItem[] = [];
    for (const [partIndex, part] of pendingParts.entries()) {
      setStatus(`Storing scene part ${partIndex + 1}/${pendingParts.length}`);
      try {
        const item =
          part.node.geometry.kind === 'serialized-object'
            ? await buildStoredScenePartItem(part.node, part.index)
            : await buildWarehouseItem(part.node, part.objectName, part.index);
        if (item) nextItems.push(item);
      } catch {
        continue;
      }
    }

    if (!nextItems.length) {
      setStatus('No scene parts to store');
      return;
    }

    commit(
      {
        ...document,
        partWarehouse: [...(document.partWarehouse ?? []), ...nextItems],
        selectedWarehouseItemId: nextItems[0].id,
      },
      `${nextItems.length} scene parts stored`,
    );
  };

  const buildFunctionalComponentFromSceneNode = async (node: SceneNode, index: number) => {
    const instanceId = functionalComponentId(document.metadata.id, `${node.id}_${node.name}_${index}`);
    const existingItem = warehouseItemForWorkspaceNode(node);
    if (existingItem?.itemType === 'part' && existingItem.functionalComponent) {
      return instantiateFunctionalComponent(
        {
          ...existingItem.functionalComponent,
          metadata: {
            ...existingItem.functionalComponent.metadata,
            reusedFromWarehouseItemId: existingItem.id,
          },
        },
        instanceId,
        node.transform,
      );
    }

    if (node.geometry.kind === 'serialized-object') {
      return buildFunctionalComponent({
        id: instanceId,
        name: node.name,
        category: inferPartCategory(node.name, node.name),
        className: inferPartClassName(node.name),
        sourceAssetName: node.geometry.assetName,
        sourceObjectName: node.name,
        bounds: node.geometry.normalizedBounds,
        material: { ...node.material },
        localTransform: node.transform,
      });
    }

    if (node.geometry.kind === 'imported-model') {
      return buildFunctionalComponent({
        id: instanceId,
        name: node.name,
        category: inferPartCategory(node.geometry.assetName, node.name),
        className: inferPartClassName(node.name),
        sourceAssetName: node.geometry.assetName,
        sourceObjectName: node.name,
        bounds: node.geometry.normalizedBounds,
        material: { ...node.material },
        localTransform: node.transform,
        sourceGraph: node.geometry.kinematicGraph,
      });
    }

    return buildFunctionalComponent({
      id: instanceId,
      name: node.name,
      category: inferPartCategory(document.metadata.name, node.name),
      className: inferPartClassName(node.name),
      sourceAssetName: document.metadata.name,
      sourceObjectName: node.name,
      bounds: [1, 1, 1],
      material: { ...node.material },
      localTransform: node.transform,
    });
  };

  const buildSceneAssemblyWarehouseItem = async (nodes: SceneNode[], name?: string, storageKey?: string): Promise<PartWarehouseAssemblyItem | undefined> => {
    if (!nodes.length) return undefined;
    const now = new Date().toISOString();
    const components = await Promise.all(nodes.map((node, index) => buildFunctionalComponentFromSceneNode(node, index)));
    const functionalAssembly = buildFunctionalAssembly({
      id: `assembly_functional_${crypto.randomUUID().slice(0, 8)}`,
      name:
        name ??
        `Scene Assembly ${String((document.partWarehouse ?? []).filter((entry) => entry.itemType === 'assembly').length + 1).padStart(2, '0')}`,
      components,
      source: 'reassembly',
    });
    const item: PartWarehouseAssemblyItem = {
      id: `assembly_${crypto.randomUUID().slice(0, 8)}`,
      itemType: 'assembly' as const,
      code: makePartCode('Assemblies', 'Composite', document.partWarehouse?.length ?? 0),
      name:
        name ??
        `Scene Assembly ${String((document.partWarehouse ?? []).filter((entry) => entry.itemType === 'assembly').length + 1).padStart(2, '0')}`,
      category: 'Assemblies' as const,
      className: 'Composite',
      sourceAssetName: document.metadata.name,
      assemblyNodes: nodes.map((node) => cloneStoredNode(node)),
      functionalAssembly,
      metadata: {
        sourceFormat: 'assembly' as const,
        originalBounds: sceneAssemblyBounds(nodes),
        storedAt: now,
        updatedAt: now,
        storageKey,
        storageProjectId: storageKey ? document.metadata.id : undefined,
      },
    };
    try {
      const previewDocument: AssetDocument = {
        ...document,
        nodes: item.assemblyNodes.map((node, index) => cloneStoredNode(node, index)),
        selectedNodeId: item.assemblyNodes[0]?.id,
      };
      item.thumbnailDataUrl = await blobToDataUrl(await renderDocumentPreview(previewDocument, 180));
    } catch {
      item.thumbnailDataUrl = undefined;
    }
    return item;
  };

  const buildWorkspaceNodeWarehouseItem = async (node: SceneNode): Promise<PartWarehouseItem | undefined> => {
    const storageKey = `workspace-${node.id}`;
    if (node.geometry.kind === 'serialized-object') {
      const item = await buildStoredScenePartItem(node, document.partWarehouse?.length ?? 0);
      if (!item) return undefined;
      return {
        ...item,
        metadata: {
          ...item.metadata,
          storageKey,
          storageProjectId: document.metadata.id,
        },
      };
    }

    if (node.geometry.kind === 'imported-model') {
      if (node.geometry.isIsolatedFunctionalComponent || node.geometry.functionalComponent || node.geometry.isolatedObjectNames?.length === 1) {
        const item = await buildWarehouseItem(node, node.geometry.isolatedObjectNames?.[0] ?? node.name, document.partWarehouse?.length ?? 0);
        if (!item) return undefined;
        return {
          ...item,
          metadata: {
            ...item.metadata,
            storageKey,
            storageProjectId: document.metadata.id,
          },
        };
      }
      return buildSceneAssemblyWarehouseItem([node], node.name, storageKey);
    }

    return buildSceneAssemblyWarehouseItem([node], node.name, storageKey);
  };

  const storeSceneAssembly = async () => {
    const nodes = storableSceneNodes();
    if (nodes.length < 2) {
      setStatus('Add at least two scene parts');
      return;
    }

    const item = await buildSceneAssemblyWarehouseItem(nodes);
    if (!item) return;

    commit(
      {
        ...document,
        partWarehouse: [...(document.partWarehouse ?? []), item],
        selectedWarehouseItemId: item.id,
      },
      'Scene assembly stored',
    );
    await saveWarehouseItemsPermanent([item], 'functional assembly');
    setStatus('Functional assembly saved');
  };

  const saveWorkspaceItemPermanent = async (nodeId: string) => {
    const node = document.nodes.find((item) => item.id === nodeId);
    if (!node) {
      setStatus('Scene object not found');
      return;
    }

    setWorkspaceMenu(undefined);
    setStatus('Saving workspace object...');
    const item = await buildWorkspaceNodeWarehouseItem(node);

    if (!item) {
      setStatus('This object cannot be stored in warehouse');
      return;
    }

    const nextWarehouse = mergeWarehouseItems(document.partWarehouse ?? [], [item]);
    commit(
      {
        ...document,
        partWarehouse: nextWarehouse,
        selectedWarehouseItemId: item.id,
      },
      'Workspace object stored',
    );
    await saveWarehouseItemsPermanent([item], 'workspace object');
    clearPendingWorkspaceNodes([nodeId]);
  };

  const savePendingWorkspaceChanges = async () => {
    const pendingNodes = pendingWorkspaceNodeIds
      .map((nodeId) => document.nodes.find((node) => node.id === nodeId))
      .filter((node): node is SceneNode => Boolean(node));
    if (!pendingNodes.length) {
      setStatus('No workspace changes to save');
      setPendingWorkspaceNodeIds([]);
      return;
    }

    setStatus(`Saving ${pendingNodes.length} workspace change${pendingNodes.length === 1 ? '' : 's'}...`);
    const items: PartWarehouseItem[] = [];
    for (const node of pendingNodes) {
      const item = await buildWorkspaceNodeWarehouseItem(node);
      if (item) items.push(item);
    }

    if (!items.length) {
      setStatus('No savable workspace objects');
      return;
    }

    const nextWarehouse = mergeWarehouseItems(document.partWarehouse ?? [], items);
    commit(
      {
        ...document,
        partWarehouse: nextWarehouse,
        selectedWarehouseItemId: items[0]?.id ?? document.selectedWarehouseItemId,
      },
      'Workspace changes stored',
    );
    await saveWarehouseItemsPermanent(items, 'workspace changes');
    clearPendingWorkspaceNodes(pendingNodes.map((node) => node.id));
  };

  const saveWorkspaceAssemblyPermanent = async () => {
    const nodes = storableSceneNodes();
    if (!nodes.length) {
      setStatus('No scene objects to store');
      return;
    }

    setWorkspaceMenu(undefined);
    setStatus('Saving workspace assembly...');
    const item = await buildSceneAssemblyWarehouseItem(nodes);
    if (!item) return;
    const nextWarehouse = mergeWarehouseItems(document.partWarehouse ?? [], [item]);
    commit(
      {
        ...document,
        partWarehouse: nextWarehouse,
        selectedWarehouseItemId: item.id,
      },
      'Workspace assembly stored',
    );
    await saveWarehouseItemsPermanent([item], 'workspace assembly');
  };

  const enterPieceAnalysis = async (event: ViewportContextMenuEvent) => {
    const activePieceAnalysis = pieceAnalysis && document.nodes.some((node) => node.id === pieceAnalysis.nodeId);
    if (activePieceAnalysis) {
      setStatus('Already in piece mode. Use right click and Exit piece mode to leave.');
      showViewportNotice('Piece mode stays active until you choose Exit piece mode from the right-click menu.', 5200);
      return;
    }
    if (pieceAnalysis) setPieceAnalysis(undefined);
    const sourceNode = document.nodes.find((node) => node.id === event.nodeId);
    if (!sourceNode || !kinematicGeometryWithGraph(sourceNode.geometry)) {
      setStatus('This object cannot enter piece analysis');
      return;
    }

    const sourceGraph = graphFromGeometry(sourceNode.geometry);
    const jointChildObjectName = event.jointId
      ? sourceGraph?.parts.find((part) => part.id === sourceGraph.joints.find((joint) => joint.id === event.jointId)?.childPartId)?.meshObjectIds.find(Boolean)
      : undefined;
    const sourceObjectName = sourceNode.geometry.kind === 'imported-model'
      ? event.objectName?.trim() || jointChildObjectName || sourceNode.geometry.isolatedObjectNames?.[0] || sourceNode.name
      : sourceNode.name;
    const name = cleanPartToken(sourceObjectName);
    const sourceAssetName = kinematicGeometryAssetName(sourceNode.geometry, sourceNode.name);
    const sourceBounds = geometrySceneBounds(sourceNode.geometry);
    const componentId = functionalComponentId(sourceAssetName, sourceObjectName);
    const graph = createStandalonePieceGraph(componentId, name, sourceObjectName, sourceBounds, pieceReferenceCenter(sourceNode.geometry));
    const component = syncComponentMotionFromGraph(
      buildFunctionalComponent({
        id: componentId,
        name,
        category: inferPartCategory(sourceNode.name, sourceObjectName),
        className: inferPartClassName(sourceObjectName),
        sourceAssetName,
        sourceObjectName,
        bounds: sourceBounds,
        material: { ...sourceNode.material },
      }),
      graph,
    );

    const geometry =
      sourceNode.geometry.kind === 'imported-model'
        ? {
            ...cloneGeometry(sourceNode.geometry),
            joints: [],
            validatedMotions: [],
            freePartTransforms: [],
            isolatedObjectNames: [sourceObjectName],
            kinematicGraph: graph,
            kinematicState: createHomeKinematicState(graph),
            functionalComponent: component,
            isIsolatedFunctionalComponent: true,
          }
        : {
            ...cloneGeometry(sourceNode.geometry),
            kinematicGraph: graph,
            kinematicState: createHomeKinematicState(graph),
            functionalComponent: component,
          };

    const now = new Date().toISOString();
    const analysisNode: SceneNode = {
      id: `piece_analysis_${crypto.randomUUID().slice(0, 8)}`,
      name,
      geometry,
      material: { ...sourceNode.material },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      locked: false,
      createdAt: now,
    };

    setPieceAnalysis({ sourceDocument: document, nodeId: analysisNode.id, sourceNodeId: sourceNode.id, sourceObjectName });
    setWorkspaceMenu(undefined);
    setSelectedParts([]);
    setDocument(touch({ ...document, nodes: [analysisNode], selectedNodeId: analysisNode.id }));
    setTool('select');
    const jointId = graph.joints[0]?.id;
    if (jointId) {
      setViewportInspection((current) => ({
        ...current,
        phase: 'repairing',
        nodeId: analysisNode.id,
        jointId,
        repairMode: 'root',
        message: 'Piece analysis mode. Define whether the piece is static or dynamic, then choose one-end or two-end movement.',
      }));
      setKinematicEditTarget({
        nodeId: analysisNode.id,
        jointId,
        mode: 'show-joint',
        origin: graph.joints[0].origin.position,
        axis: graph.joints[0].axis,
        focusKey: `piece-analysis-${jointId}-${Date.now()}`,
      });
      setStatus('Showing isolated piece reference axes');
    }
    showViewportNotice('Piece analysis mode: only this piece is visible. Previous model movements were cleared.', 6500);
  };

  const exitPieceAnalysis = async (saveBeforeExit = true) => {
    if (!pieceAnalysis) return;
    const analysisNode = document.nodes.find((node) => node.id === pieceAnalysis.nodeId);
    let nextSourceDocument = pieceAnalysis.sourceDocument;

    if (saveBeforeExit && analysisNode) {
      const item = await buildWorkspaceNodeWarehouseItem(analysisNode);
      if (item) {
        nextSourceDocument = {
          ...nextSourceDocument,
          partWarehouse: mergeWarehouseItems(nextSourceDocument.partWarehouse ?? [], [item]),
          selectedWarehouseItemId: item.id,
        };
      }
    }

    setPieceAnalysis(undefined);
    setWorkspaceMenu(undefined);
    setKinematicEditTarget(undefined);
    setViewportInspection((current) => ({
      ...current,
      phase: 'idle',
      nodeId: undefined,
      jointId: undefined,
      repairMode: undefined,
      message: saveBeforeExit ? 'Piece motion metadata stored in the warehouse list.' : 'Piece analysis closed.',
    }));
    setDocument(touch(nextSourceDocument));
    setStatus(saveBeforeExit ? 'Piece mode closed and metadata stored' : 'Piece mode closed');
  };

  const preparePieceMotionCorrection = (nodeId: string) => {
    const node = document.nodes.find((item) => item.id === nodeId);
    const graph = node ? graphFromGeometry(node.geometry) : undefined;
    const joint = graph?.joints[0];
    if (!node || !graph || !joint) return;
    setWorkspaceMenu(undefined);
    setViewportInspection((current) => ({
      ...current,
      phase: 'repairing',
      nodeId,
      jointId: joint.id,
      repairMode: 'root',
      message: 'Define static/dynamic, one-end/two-end, then axis and limits. The piece will not move until Test Movement.',
    }));
    startKinematicEditForNode(nodeId, joint.id, 'show-joint');
  };

  const setPieceStaticMode = (nodeId: string, jointId: string, isStatic: boolean) => {
    updateKinematicGraphForNode(
      nodeId,
      (graph) =>
        updateJoint(graph, jointId, {
          type: isStatic ? 'fixed' : 'revolute',
          motionProfile: isStatic ? undefined : 'rotation-around-origin',
          motionPlane: isStatic ? undefined : 'xy',
          limits: isStatic ? undefined : { lower: -0.8, upper: 0.8 },
        }),
      isStatic ? 'Piece marked static' : 'Piece marked dynamic',
      true,
    );
  };

  const setPieceEndpointMode = (nodeId: string, jointId: string, endpointMode: 'single' | 'two-end') => {
    const node = document.nodes.find((item) => item.id === nodeId);
    const joint = node ? graphFromGeometry(node.geometry)?.joints.find((item) => item.id === jointId) : undefined;
    if (!joint) return;
    if (endpointMode === 'two-end') {
      setStatus('Two-end pieces require two independent joints');
      showViewportNotice('M2 does not create hybrid motions. Define one joint frame for each mechanical interface.', 6200);
      return;
    }

    updateKinematicJointForNode(nodeId, jointId, {
      type: 'revolute',
      motionProfile: 'rotation-around-origin',
      motionPlane: joint.motionPlane ?? rotationPlaneForAxis(joint.axis),
      drivenPoint: undefined,
      limits: joint.limits ?? { lower: -0.8, upper: 0.8 },
    });
    startKinematicEditForNode(nodeId, jointId, 'show-joint');
  };

  const updateWarehouseItemFromSelection = async (copy: boolean) => {
    if (!selectedWarehouseItem || selectedWarehouseItem.itemType !== 'part' || !selectedNode) return;
    const nextItem =
      selectedNode.geometry.kind === 'serialized-object'
        ? await buildStoredScenePartItem(selectedNode, 0)
        : selectedNode.geometry.kind === 'imported-model'
          ? await buildWarehouseItem(selectedNode, selectedParts.find((part) => part.nodeId === selectedNode.id)?.objectName ?? selectedNode.geometry.isolatedObjectNames?.[0] ?? '', 0)
          : undefined;
    if (!nextItem) return;
    const itemToStore = copy
      ? { ...nextItem, name: `${nextItem.name} Copy`, code: makePartCode(nextItem.category, nextItem.className, document.partWarehouse?.length ?? 0) }
      : { ...nextItem, id: selectedWarehouseItem.id, code: selectedWarehouseItem.code, metadata: { ...nextItem.metadata, storedAt: selectedWarehouseItem.metadata.storedAt } };

    commit(
      {
        ...document,
        partWarehouse: copy
          ? [...(document.partWarehouse ?? []), itemToStore]
          : (document.partWarehouse ?? []).map((item) => (item.id === selectedWarehouseItem.id ? itemToStore : item)),
        selectedWarehouseItemId: itemToStore.id,
      },
      copy ? 'Warehouse copy created' : 'Warehouse part updated',
    );
    await saveWarehouseItemsPermanent([itemToStore], copy ? 'warehouse copy' : 'warehouse item');
  };

  const undo = () => {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [document, ...items]);
    setDocument(previous);
    setIssues(validateProject(previous));
    setStatus('Undo');
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((items) => items.slice(1));
    setPast((items) => [...items, document]);
    setDocument(next);
    setIssues(validateProject(next));
    setStatus('Redo');
  };

  const save = async () => {
    try {
      const saved = saveProjectToBrowser(document);
      setDocument(saved);

      if (desktopRuntime) {
        const filePath = await saveProjectNative(saved, nativeProjectPath);
        if (filePath) {
          setNativeProjectPath(filePath);
          setStatus(`Project saved: ${filePath}`);
        } else {
          setStatus('Save cancelled');
        }
        return;
      }

      downloadProjectFile(saved);
      setStatus('Project saved to browser storage and JSON');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    }
  };

  const openNativeProject = async () => {
    if (!desktopRuntime) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const result = await openProjectNative();
      if (!result) {
        setStatus('Open cancelled');
        return;
      }

      setPast((items) => [...items, document]);
      setFuture([]);
      setDocument(result.document);
      setNativeProjectPath(result.path);
      setIssues(validateProject(result.document));
      saveProjectToBrowser(result.document);
      setStatus(`Opened ${result.path}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Open failed');
    }
  };

  const openProjectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as AssetDocument;
        if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.nodes)) {
          throw new Error('Invalid project file.');
        }
        setPast((items) => [...items, document]);
        setFuture([]);
        setDocument(parsed);
        setNativeProjectPath(undefined);
        setIssues(validateProject(parsed));
        setStatus(`Opened ${file.name}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Open failed');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const exportTwinPackage = async () => {
    try {
      const project = selectedNode && graphFromGeometry(selectedNode.geometry)
        ? createPlcTwinProjectForNode(selectedNode, { timestampUtc: new Date().toISOString() })
        : createTwinProjectFromAssetDocument(document, { mode: 'simulation', timestampUtc: new Date().toISOString(), includeSimulatedBindings: true });
      const pkg = createTwinPackage({ project, sourceDocument: document, includeRuntime: true, historian: historianRecords, alarmRules, alarmInstances, scenarios: simulationScenarios, connectionProfiles, signalMappings: registerConfiguration });
      const filename = `${document.metadata.name.replace(/\s+/g, '-').toLowerCase()}.twin`;
      if (desktopRuntime) {
        const path = await saveJsonNative(pkg, filename);
        setStatus(path ? `Twin Package saved: ${path}` : 'Twin Package export cancelled');
      } else {
        downloadBlob(new Blob([serializeTwinPackage(pkg)], { type: 'application/vnd.twinaxis.twin+json' }), filename);
        setStatus(`Twin Package exported: ${filename}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Twin Package export failed');
    }
  };

  const importTwinPackage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const pkg = parseTwinPackage(String(reader.result));
        if (!pkg.sourceDocument) throw new Error('Twin Package has no source document to restore in the workspace.');
        setPast((items) => [...items, document]);
        setFuture([]);
        setDocument(pkg.sourceDocument);
        setHistorianRecords(pkg.runtime?.historian ?? []);
        setAlarmRules(pkg.runtime?.alarmRules ?? []);
        setAlarmInstances(pkg.runtime?.alarmInstances ?? []);
        setSimulationScenarios(pkg.runtime?.scenarios ?? []);
        setConnectionProfiles(pkg.configuration?.connectionProfiles.length ? pkg.configuration.connectionProfiles : defaultConnectionProfiles());
        setRegisterConfiguration(pkg.configuration?.signalMappings.length ? pkg.configuration.signalMappings as InternalRegisterDefinition[] : systemRegisterDefinitions());
        setActiveScenarioId(undefined);
        setScenarioRunning(false);
        setReplayFrameIndex(-1);
        historianRecordKeysRef.current = new Set((pkg.runtime?.historian ?? []).map((record) => `${record.kind}|${record.sourceTimestampUtc}|${record.sequence}`));
        setIssues(validateProject(pkg.sourceDocument));
        saveProjectToBrowser(pkg.sourceDocument);
        setStatus(`Twin Package loaded: ${pkg.manifest.name} v${pkg.manifest.version}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Twin Package import failed');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const importModelFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setStatus(`Importing ${file.name}...`);
      const node = await createImportedModelNode(file);
      const replacingStarterPlaceholder = document.nodes.length === 1 && isStarterPlaceholderNode(document.nodes[0]);
      if (replacingStarterPlaceholder) {
        commit(
          {
            ...document,
            nodes: [node],
            selectedNodeId: node.id,
          },
          node.geometry.kind === 'imported-model' && node.geometry.joints.length ? 'Articulated model imported' : 'Static model imported',
        );
        markWorkspaceNodesPending([node.id]);
      } else {
        addNode(node, node.geometry.kind === 'imported-model' && node.geometry.joints.length ? 'Articulated model imported' : 'Static model imported');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'GLB import failed');
    } finally {
      event.target.value = '';
    }
  };

  const removeSelected = () => {
    if (!selectedNode) return;
    if (selectedNode.locked) {
      setStatus('Object is locked');
      return;
    }
    commit(
      {
        ...document,
        nodes: document.nodes.filter((node) => node.id !== selectedNode.id),
        selectedNodeId: undefined,
      },
      'Object deleted',
    );
    clearPendingWorkspaceNodes([selectedNode.id]);
  };

  const duplicateSelected = () => {
    if (!selectedNode) return;
    const copy = cloneSceneNode(selectedNode);
    commit(
      {
        ...document,
        nodes: [...document.nodes, copy],
        selectedNodeId: copy.id,
      },
      'Object duplicated',
    );
    markWorkspaceNodesPending([copy.id]);
  };

  const toggleSelectedVisibility = () => {
    if (!selectedNode) return;
    commit(
      {
        ...document,
        nodes: document.nodes.map((node) => (node.id === selectedNode.id ? { ...node, visible: !node.visible } : node)),
      },
      selectedNode.visible ? 'Object hidden' : 'Object visible',
    );
  };

  const toggleSelectedLock = () => {
    if (!selectedNode) return;
    commit(
      {
        ...document,
        nodes: document.nodes.map((node) => (node.id === selectedNode.id ? { ...node, locked: !node.locked } : node)),
      },
      selectedNode.locked ? 'Object unlocked' : 'Object locked',
    );
  };

  const restoreAutosave = () => {
    try {
      const autosave = loadProjectAutosave();
      if (!autosave) {
        setStatus('No autosave found');
        return;
      }

      setPast((items) => [...items, document]);
      setFuture([]);
      setDocument(autosave);
      setIssues(validateProject(autosave));
      setStatus('Autosave restored');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Autosave restore failed');
    }
  };

  const validate = () => {
    const nextIssues = validateProject(document);
    setIssues(nextIssues);
    setStatus(nextIssues.some((issue) => issue.severity === 'error') ? 'Validation failed' : 'Validation passed');
  };

  const runPreflight = () => {
    const profile = getExportProfile(exportProfileId);
    const nextIssues = runExportPreflight(document, profile);
    setIssues(nextIssues);
    setStatus(nextIssues.some((issue) => issue.severity === 'error') ? 'Preflight failed' : `Preflight passed for ${profile.name}`);
  };

  const renderPreview = async () => {
    setStatus('Rendering preview...');
    try {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const blob = await renderDocumentPreview(document);
      setPreviewUrl(URL.createObjectURL(blob));
      setStatus(`Preview rendered (${Math.round(blob.size / 1024)} KB)`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Preview failed');
    }
  };

  const savePreview = async () => {
    if (!previewUrl) return;

    const blob = await fetch(previewUrl).then((response) => response.blob());
    const fileName = `${document.metadata.name.replace(/\s+/g, '-').toLowerCase()}-preview.png`;
    if (desktopRuntime) {
      const filePath = await saveBlobNative(blob, fileName, 'png');
      setStatus(filePath ? `Preview saved: ${filePath}` : 'Preview save cancelled');
    } else {
      downloadBlob(blob, fileName);
      setStatus('Preview downloaded');
    }
  };

  const exportGlb = async () => {
    const profile = getExportProfile(exportProfileId);
    const nextIssues = runExportPreflight(document, profile);
    setIssues(nextIssues);
    if (nextIssues.some((issue) => issue.severity === 'error')) {
      setStatus('Export blocked by validation errors');
      return;
    }

    setStatus('Exporting GLB...');
    const startedAt = performance.now();
    const blob = await exportDocumentAsGlb(document);
    const fileName = `${document.metadata.name.replace(/\s+/g, '-').toLowerCase()}-${profile.filenameSuffix}.glb`;
    const report = buildExportReport(document, profile, fileName, blob.size, Math.round(performance.now() - startedAt), nextIssues);
    if (desktopRuntime) {
      const exportedPath = await saveBlobNative(blob, fileName, 'glb');
      if (!exportedPath) {
        setStatus('Export cancelled');
        return;
      }
      await saveJsonNative(report, fileName.replace(/\.glb$/, '.export-report.json'));
    } else {
      downloadBlob(blob, fileName);
      exportJsonReport(report, fileName.replace(/\.glb$/, '.export-report.json'));
    }
    setExportReport(report);
    setStatus(`GLB exported (${report.fileSizeKb} KB, ${profile.name})`);
  };

  const setTransformValue = (field: keyof Transform, index: number, value: number) => {
    updateSelectedNode((node) => {
      const nextTuple = [...node.transform[field]] as [number, number, number];
      nextTuple[index] = value;
      return {
        ...node,
        transform: {
          ...node.transform,
          [field]: nextTuple,
        },
      };
    });
  };

  const setMaterialValue = (field: 'color' | 'roughness' | 'metalness', value: string | number) => {
    updateSelectedNode((node) => ({
      ...node,
      material: {
        ...node.material,
        name: field === 'color' ? 'Custom Color' : node.material.name,
        [field]: value,
      },
    }));
  };

  const applyMaterialPreset = (presetName: string) => {
    const preset = materialPresets.find((item) => item.name === presetName);
    if (!preset) return;
    updateSelectedNode(
      (node) => ({
        ...node,
        material: { ...preset },
      }),
      'Material preset applied',
    );
  };

  const setGeometryValue = (field: string, value: number) => {
    updateSelectedNode((node) => {
      const geometry = node.geometry;
      if ('generatorId' in geometry) {
        const nextParams = clampGeneratorParams(geometry.generatorId, {
          ...geometry.params,
          [field]: value,
        });

        return {
          ...node,
          geometry: {
            ...geometry,
            params: nextParams,
          },
        };
      }

      return {
        ...node,
        geometry: {
          ...geometry,
          [field]: value,
        } as GeometryDefinition,
      };
    }, 'Geometry updated');
  };

  const setImportedJointMotion = (jointName: string, value: number) => {
    if (!selectedNode) return;
    setImportedJointMotionForNode(selectedNode.id, jointName, value);
  };

  const setImportedJointMotionForNode = (nodeId: string, jointName: string, value: number) => {
    setDemoMotionNodeId((current) => (current === nodeId ? undefined : current));
    setDocument((current) =>
      touch({
        ...current,
        selectedNodeId: nodeId,
        nodes: current.nodes.map((node) => {
          if (node.id !== nodeId || node.geometry.kind !== 'imported-model') return node;

          return {
            ...node,
            geometry: {
              ...node.geometry,
              joints: node.geometry.joints.map((joint) => {
                if (joint.name !== jointName) return joint;
                const axis = joint.axis === 'y' ? 1 : joint.axis === 'z' ? 2 : 0;
                const rotation: [number, number, number] = [0, 0, 0];
                const translation: [number, number, number] = [0, 0, 0];
                if (joint.motionKind === 'translation') translation[axis] = value;
                else rotation[axis] = value;
                return {
                  ...joint,
                  rotation,
                  translation,
                };
              }),
              kinematicState:
                node.geometry.kinematicGraph && node.geometry.kinematicState
                  ? {
                      homeJointValues: { ...node.geometry.kinematicState.homeJointValues },
                      jointValues: {
                        ...node.geometry.kinematicState.jointValues,
                        ...Object.fromEntries(
                          node.geometry.kinematicGraph.joints
                            .filter((joint) => joint.name === jointName)
                            .map((joint) => [joint.id, value]),
                        ),
                      },
                    }
                  : node.geometry.kinematicState,
            },
          };
        }),
      }),
    );
    markWorkspaceNodesPending([nodeId]);
    setStatus('Joint adjusted');
  };

  const updateKinematicGraphForNode = (
    nodeId: string,
    updater: (graph: KinematicGraph, geometry: KinematicSceneGeometry) => KinematicGraph,
    nextStatus: string,
    resetPose = false,
  ) => {
    setDemoMotionNodeId((current) => (current === nodeId ? undefined : current));
    setDocument((current) => {
      const nextDocument = touch({
        ...current,
        selectedNodeId: nodeId,
        nodes: current.nodes.map((node) => {
          if (node.id !== nodeId || !kinematicGeometryWithGraph(node.geometry)) return node;
          const baseGraph = graphFromGeometry(node.geometry) ?? createStandalonePieceGraph(`component_${node.id}`, node.name, node.name, geometrySceneBounds(node.geometry));
          const graph = updater(baseGraph, node.geometry);
          const homeState = createHomeKinematicState(graph);
          const state = resetPose ? homeState : (node.geometry.kinematicState ?? homeState);
          const functionalComponent = syncComponentMotionFromGraph(node.geometry.functionalComponent, graph);
          return {
            ...node,
            geometry: {
              ...node.geometry,
              kinematicGraph: graph,
              kinematicState: {
                homeJointValues: { ...homeState.homeJointValues, ...state.homeJointValues },
                jointValues: resetPose ? { ...homeState.jointValues } : { ...homeState.jointValues, ...state.jointValues },
              },
              functionalComponent,
            },
          };
        }),
      });
      setIssues(validateProject(nextDocument));
      return nextDocument;
    });
    markWorkspaceNodesPending([nodeId]);
    setStatus(nextStatus);
  };

  const setKinematicJointValueForNode = (nodeId: string, jointId: string, value: number) => {
    setDemoMotionNodeId((current) => (current === nodeId ? undefined : current));
    setDocument((current) =>
      touch({
        ...current,
        selectedNodeId: nodeId,
        nodes: current.nodes.map((node) => {
          if (node.id !== nodeId || !kinematicGeometryWithGraph(node.geometry)) return node;
          const graph = graphFromGeometry(node.geometry);
          if (!graph) return node;
          return {
            ...node,
            geometry: {
              ...node.geometry,
              kinematicGraph: graph,
              kinematicState: setJointValue(graph, node.geometry.kinematicState, jointId, value),
            },
          };
        }),
      }),
    );
    setStatus('Joint test updated');
  };

  const setKinematicJointValuesForNode = useCallback((nodeId: string, values: Record<string, number>) => {
    setDemoMotionNodeId((current) => (current === nodeId ? undefined : current));
    setDocument((current) =>
      touch({
        ...current,
        selectedNodeId: nodeId,
        nodes: current.nodes.map((node) => {
          if (node.id !== nodeId || !kinematicGeometryWithGraph(node.geometry)) return node;
          const graph = graphFromGeometry(node.geometry);
          if (!graph) return node;
          const baseState = node.geometry.kinematicState ?? createHomeKinematicState(graph);
          return {
            ...node,
            geometry: {
              ...node.geometry,
              kinematicGraph: graph,
              kinematicState: {
                homeJointValues: { ...baseState.homeJointValues },
                jointValues: { ...baseState.jointValues, ...values },
              },
            },
          };
        }),
      }),
    );
  }, []);

  useEffect(() => {
    const runtimeWindow = window as Window & {
      __assetForgeSetKinematicJointValues?: (nodeId: string, values: Record<string, number>) => boolean;
    };
    runtimeWindow.__assetForgeSetKinematicJointValues = (nodeId, values) => {
      setKinematicJointValuesForNode(nodeId, values);
      return true;
    };
    return () => {
      delete runtimeWindow.__assetForgeSetKinematicJointValues;
    };
  }, [setKinematicJointValuesForNode]);

  useEffect(() => {
    plcDashboardRef.current = plcDashboard;
  }, [plcDashboard]);

  useEffect(() => {
    const saved = loadPlcEndpoint();
    if (!saved.endpointProfile) return;
    setPlcDashboard((current) => ({
      ...current,
      openPlc: {
        ...current.openPlc,
        ...saved,
        enabled: Boolean(saved.autoReconnect && saved.connectionAuthorized && saved.controlledNodeId),
        online: false,
        diagnostics: saved.autoReconnect && saved.connectionAuthorized && saved.controlledNodeId
          ? `Automatic reconnect armed for ${saved.host}:${saved.port}. Waiting for PLC network...`
          : saved.autoReconnect && saved.connectionAuthorized
            ? 'Automatic reconnect paused: select the robot and connect once to bind PLC authority safely.'
            : current.openPlc.diagnostics,
      },
    }));
  }, []);

  useEffect(() => {
    const config = plcDashboard.openPlc;
    const persisted: PersistedPlcEndpoint = {
      endpointProfile: config.endpointProfile,
      host: config.host,
      port: config.port,
      unitId: config.unitId,
      address: config.address,
      quantity: config.quantity,
      dataFormat: config.dataFormat,
      pollMs: config.pollMs,
      autoReconnect: config.autoReconnect,
      connectionAuthorized: config.connectionAuthorized,
      controlledNodeId: config.controlledNodeId,
    };
    window.localStorage.setItem(PLC_ENDPOINT_KEY, JSON.stringify(persisted));
  }, [plcDashboard.openPlc.endpointProfile, plcDashboard.openPlc.host, plcDashboard.openPlc.port, plcDashboard.openPlc.unitId, plcDashboard.openPlc.address, plcDashboard.openPlc.quantity, plcDashboard.openPlc.dataFormat, plcDashboard.openPlc.pollMs, plcDashboard.openPlc.autoReconnect, plcDashboard.openPlc.connectionAuthorized, plcDashboard.openPlc.controlledNodeId]);

  const selectedKinematicNode = selectedNode && graphFromGeometry(selectedNode.geometry)
    ? selectedNode
    : document.nodes.find((node) => node.visible && Boolean(graphFromGeometry(node.geometry)));
  const plcControlledKinematicNode = plcDashboard.openPlc.enabled
    ? document.nodes.find((node) => node.id === plcDashboard.openPlc.controlledNodeId && Boolean(graphFromGeometry(node.geometry)))
    : undefined;

  useEffect(() => {
    window.localStorage.setItem(REGISTER_CONFIGURATION_KEY, JSON.stringify(registerConfiguration));
  }, [registerConfiguration]);

  useEffect(() => {
    window.localStorage.setItem(CONNECTION_PROFILES_KEY, JSON.stringify(connectionProfiles));
  }, [connectionProfiles]);

  useEffect(() => {
    if (!selectedKinematicNode) return;
    const graph = graphFromGeometry(selectedKinematicNode.geometry);
    if (!graph) return;
    setRegisterConfiguration((current) => {
      const existingKeys = new Set(current.filter((item) => item.role === 'joint').map((item) => `${item.robotNodeId}:${item.jointId}`));
      let nextWire = Math.max(99, ...current.filter((item) => item.role === 'joint').map((item) => item.wire));
      const additions = graph.joints.filter((joint) => joint.type !== 'fixed' && !existingKeys.has(`${selectedKinematicNode.id}:${joint.id}`)).map((joint) => ({
        id: `joint-${selectedKinematicNode.id}-${joint.id}`,
        wire: ++nextWire,
        semantic: `${selectedKinematicNode.name} / ${joint.name}`,
        encoding: 'int16-rad-x10000' as RegisterEncoding,
        access: 'plc-to-platform' as RegisterAccess,
        enabled: true,
        role: 'joint' as const,
        robotNodeId: selectedKinematicNode.id,
        jointId: joint.id,
      }));
      return additions.length ? [...current, ...additions] : current;
    });
  }, [selectedKinematicNode?.id]);

  const configurePlcProject = useCallback((node: SceneNode, project: TwinProject) => {
    const signalById = new Map(project.signals.map((signal) => [signal.id, signal]));
    const configured = registerConfiguration.filter((entry) => entry.enabled && entry.role === 'joint' && entry.robotNodeId === node.id && entry.jointId);
    const bindings = project.bindings.map((binding) => {
      if (binding.protocol !== 'modbus' || binding.mapping.kind !== 'modbus') return binding;
      const signal = signalById.get(binding.signalId);
      const jointId = String(signal?.metadata.jointId ?? binding.metadata.jointId ?? '');
      const entry = configured.find((item) => item.jointId === jointId);
      if (!entry) return binding;
      return {
        ...binding,
        connectionId: entry.connectionId ?? binding.connectionId,
        mapping: {
          ...binding.mapping,
          address: entry.wire,
          displayAddress: String(registerHr(entry.wire)),
          quantity: registerWordCount(entry.encoding),
          dataType: entry.encoding === 'float32-be' ? 'f32' as const : entry.encoding === 'uint16' ? 'u16' as const : 'i16' as const,
          byteOrder: 'be' as const,
          wordOrder: 'high-low' as const,
        },
        metadata: { ...binding.metadata, registerConfigurationId: entry.id, encoding: entry.encoding, pollingMs: mappingPollingMs(entry) },
      };
    });
    const bindingById = new Map(bindings.map((binding) => [binding.id, binding]));
    return {
      ...project,
      bindings,
      signalBindings: project.signalBindings.map((binding) => {
        const legacy = bindingById.get(binding.id);
        if (!legacy) return binding;
        const entry = configured.find((item) => item.jointId === legacy.metadata.jointId);
        if (!entry) return { ...binding, connectionId: legacy.connectionId, source: legacy.mapping, pollingMs: Number(legacy.metadata.pollingMs ?? binding.pollingMs ?? 250) };
        const protocol = entry.protocol ?? 'modbus';
        const source = protocol === 'mqtt'
          ? { kind: 'mqtt' as const, topic: entry.topic ?? `twinaxis/${node.id}/${entry.jointId}`, payload: 'json' as const, valuePath: entry.valuePath || 'value', qos: entry.qos ?? 0 }
          : protocol === 'opcua'
            ? { kind: 'opcua' as const, nodeId: entry.opcUaNodeId ?? `ns=2;s=${node.name}.${entry.jointId}`, browsePath: entry.opcUaBrowsePath || undefined }
            : legacy.mapping;
        return {
          ...binding,
          protocol,
          connectionId: entry.connectionId ?? (protocol === 'mqtt' ? 'mqtt-main' : protocol === 'opcua' ? 'opcua-main' : legacy.connectionId),
          source,
          transform: { scale: mappingScale(entry), offset: mappingOffset(entry), unitOut: entry.unit },
          pollingMs: mappingPollingMs(entry),
          metadata: { ...binding.metadata, registerConfigurationId: entry.id },
        };
      }),
    };
  }, [registerConfiguration]);

  const createConfiguredPlcProject = useCallback((node: SceneNode, timestampUtc = new Date().toISOString()) =>
    configurePlcProject(node, createPlcTwinProjectForNode(node, { timestampUtc })), [configurePlcProject]);

  useEffect(() => {
    if (!selectedKinematicNode) return;
    setPlcDashboard((current) => current.openPlc.enabled || current.frameNodeId === selectedKinematicNode.id ? current : ({
      ...current,
      localManualActive: false,
      frameNodeId: selectedKinematicNode.id,
      project: undefined,
      frame: undefined,
      registerOverrides: {},
      message: `PLC bindings rebuilt for ${selectedKinematicNode.name}.`,
    }));
  }, [selectedKinematicNode?.id]);

  const runPlcDashboardFrame = useCallback(
    (node: SceneNode, elapsedSeconds: number, sequence: number, project?: TwinProject, registerOverrides?: Record<string, number>, persistPose = true) => {
      const frame = runPlcModbusSimulationFrame(node, {
        project: project ? configurePlcProject(node, project) : createConfiguredPlcProject(node),
        elapsedSeconds,
        sequence,
        nowMs: Date.now(),
        registerOverrides,
      });
      if (persistPose) setKinematicJointValuesForNode(node.id, frame.jointValues);
      setPlcDashboard((current) => ({
        ...current,
        project: frame.project,
        frame,
        frameNodeId: node.id,
        sequence,
        message: `${frame.samples.length} Modbus samples reflected in digital twin`,
      }));
      return frame;
    },
    [configurePlcProject, createConfiguredPlcProject, setKinematicJointValuesForNode],
  );

  useEffect(() => {
    if (!plcDashboard.openPlc.enabled && !plcDashboard.externalBridgeEnabled) {
      setExternalPlcRuntimePose(undefined);
    }
  }, [plcDashboard.openPlc.enabled, plcDashboard.externalBridgeEnabled]);

  const startPlcDashboard = () => {
    if (!selectedKinematicNode) {
      setPlcDashboard((current) => ({ ...current, open: true, running: false, message: 'Select a robot or machine with KinematicGraph first.' }));
      setStatus('Select a kinematic object first');
      return;
    }
    try {
      const currentPlc = plcDashboardRef.current.plc;
      const startedPlc = executeVirtualPlcScan(currentPlc, {
        nowMs: currentPlc.scan.lastScanAtMs + currentPlc.scan.targetMs,
        runCommand: true,
        communicationHealthy: true,
      });
      if (startedPlc.mode !== 'RUN') {
        setPlcDashboard((current) => ({ ...current, running: false, plc: startedPlc, message: 'PLC start inhibited. Restore safety inputs and reset the fault.' }));
        setStatus('PLC start inhibited by safety interlock');
        return;
      }
      const project = createConfiguredPlcProject(selectedKinematicNode);
      const startedAtMs = performance.now();
      const frame = runPlcDashboardFrame(selectedKinematicNode, 0, plcDashboard.sequence + 1, project, plcDashboard.registerOverrides);
      setPlcDashboard((current) => ({
        ...current,
        open: true,
        running: true,
        project: frame.project,
        frame,
        frameNodeId: selectedKinematicNode.id,
        startedAtMs,
        sequence: current.sequence + 1,
        message: 'Local PLC simulator is publishing Modbus registers.',
        plc: startedPlc,
      }));
      setStatus('PLC Modbus test running');
    } catch (error) {
      setPlcDashboard((current) => ({ ...current, open: true, running: false, message: error instanceof Error ? error.message : 'PLC dashboard failed' }));
      setStatus(error instanceof Error ? error.message : 'PLC dashboard failed');
    }
  };

  const stopPlcDashboard = () => {
    setPlcDashboard((current) => ({
      ...current,
      running: false,
      plc: executeVirtualPlcScan(current.plc, { nowMs: current.plc.scan.lastScanAtMs + current.plc.scan.targetMs, runCommand: false }),
      message: 'PLC simulator stopped; outputs are disabled and the last digital twin state is held.',
    }));
    setStatus('PLC Modbus test stopped');
  };

  const togglePlcDashboard = () => {
    setActiveView('workspace');
    setPlcDashboard((current) => ({
      ...current,
      open: !current.open,
      running: current.open ? false : current.running,
      externalBridgeEnabled: current.open ? current.externalBridgeEnabled : !current.externalBridgeDisconnectedByUser,
      message: !current.open && !selectedKinematicNode ? 'Select a robot or machine with KinematicGraph first.' : current.message,
    }));
  };

  const stepPlcDashboard = () => {
    if (!selectedKinematicNode) return;
    try {
      const current = plcDashboardRef.current;
      const elapsedSeconds = ((performance.now() - (current.startedAtMs ?? performance.now())) / 1000) + 0.35;
      runPlcDashboardFrame(selectedKinematicNode, elapsedSeconds, current.sequence + 1, current.frameNodeId === selectedKinematicNode.id ? current.project : undefined, current.registerOverrides);
      setStatus('PLC Modbus step applied');
    } catch (error) {
      setPlcDashboard((current) => ({ ...current, running: false, message: error instanceof Error ? error.message : 'PLC step failed' }));
      setStatus(error instanceof Error ? error.message : 'PLC step failed');
    }
  };

  useEffect(() => {
    if (!plcDashboard.running || !selectedKinematicNode) return undefined;
    const timer = window.setInterval(() => {
      const current = plcDashboardRef.current;
      const startedAtMs = current.startedAtMs ?? performance.now();
      const elapsedSeconds = (performance.now() - startedAtMs) / 1000;
      try {
        runPlcDashboardFrame(selectedKinematicNode, elapsedSeconds, current.sequence + 1, current.frameNodeId === selectedKinematicNode.id ? current.project : undefined, current.registerOverrides);
      } catch (error) {
        setPlcDashboard((state) => ({ ...state, running: false, message: error instanceof Error ? error.message : 'PLC simulator failed' }));
      }
    }, 180);
    return () => window.clearInterval(timer);
  }, [plcDashboard.running, selectedKinematicNode, runPlcDashboardFrame]);

  useEffect(() => {
    if (!plcDashboard.open) return undefined;
    const timer = window.setInterval(() => {
      setPlcDashboard((current) => {
        let plc = current.plc;
        const scans = Math.max(1, Math.round(100 / plc.scan.targetMs));
        for (let index = 0; index < scans; index += 1) {
          plc = executeVirtualPlcScan(plc, {
            nowMs: plc.scan.lastScanAtMs + plc.scan.targetMs,
            runCommand: current.running,
            communicationHealthy: !current.externalBridgeEnabled || current.externalBridgeServerOnline,
          });
        }
        const safetyStopped = current.running && !plc.outputs.motorEnable;
        return {
          ...current,
          plc,
          running: safetyStopped ? false : current.running,
          message: safetyStopped ? 'PLC entered FAULT. Motion outputs were disabled by the safety program.' : current.message,
        };
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [plcDashboard.open]);

  const setPlcInput = <K extends keyof VirtualPlcInputs>(key: K, value: VirtualPlcInputs[K]) => {
    setPlcDashboard((current) => {
      let plc = setVirtualPlcInput(current.plc, key, value);
      plc = executeVirtualPlcScan(plc, { nowMs: plc.scan.lastScanAtMs + plc.scan.targetMs, runCommand: current.running });
      return {
        ...current,
        plc,
        running: current.running && plc.outputs.motorEnable,
        message: plc.mode === 'FAULT' ? 'Safety circuit opened. PLC is in FAULT and motion is inhibited.' : current.message,
      };
    });
  };

  const resetPlcFault = () => {
    setPlcDashboard((current) => {
      const plc = resetVirtualPlcFault(current.plc);
      return { ...current, running: false, plc, message: plc.mode === 'FAULT' ? 'Reset blocked: restore E-Stop, guard and servo readiness first.' : 'PLC fault reset. Controller is in STOP.' };
    });
  };

  const changePlcScanTarget = (targetMs: number) => {
    setPlcDashboard((current) => ({ ...current, plc: setVirtualPlcScanTarget(current.plc, targetMs) }));
  };

  const physicalPlcWire: Record<string, number> = {
    'system-command': 0, 'system-status': 1, 'system-step': 2, 'system-time': 3,
    'system-alarm': 4, 'system-condition': 5, 'system-speed': 6,
    'iot-temperature': 13, 'iot-humidity': 14, 'iot-gyro': 15, 'iot-age': 16,
    'iot-valid': 17, 'iot-sequence': 18, 'iot-quality': 19, 'iot-policy': 20,
  };
  const documentedOpenPlcWire: Record<string, number> = {
    'system-command': 90, 'system-status': 91, 'system-step': 92, 'system-time': 93,
    'system-alarm': 94, 'system-condition': 95, 'system-speed': 96,
    'iot-temperature': 120, 'iot-humidity': 121, 'iot-gyro': 122, 'iot-age': 123,
    'iot-valid': 124, 'iot-sequence': 125, 'iot-quality': 126, 'iot-policy': 127,
  };

  const configuredPlcWire = (config: PlcDashboardState['openPlc'], id: string, fallback: number) =>
    config.endpointProfile === 's7-1200-robot-holding'
      ? physicalPlcWire[id] ?? fallback
      : documentedOpenPlcWire[id] ?? fallback;

  const updateOpenPlcConfig = (field: 'endpointProfile' | 'host' | 'port' | 'unitId' | 'address' | 'pollMs' | 'dataFormat' | 'autoReconnect', value: string | number | boolean) => {
    setPlcDashboard((current) => ({
      ...current,
      openPlc: {
        ...current.openPlc,
        [field]: field === 'autoReconnect' ? Boolean(value) : field === 'host' || field === 'dataFormat' || field === 'endpointProfile' ? String(value) : Number(value),
        ...(field === 'endpointProfile' ? {
          address: value === 's7-1200-robot-holding' ? 7 : 100,
          host: value === 's7-1200-robot-holding'
            ? (current.openPlc.host === '127.0.0.1' ? '192.168.0.20' : current.openPlc.host)
            : (current.openPlc.host === '192.168.0.20' ? '127.0.0.1' : current.openPlc.host),
          quantity: 6,
          dataFormat: 'int16-rad-x10000' as const,
          connectionAuthorized: false,
          autoReconnect: false,
          online: false,
          runtimeRunning: undefined,
          runtimeIssue: undefined,
          rawRegisters: undefined,
          received: 0,
          diagnostics: value === 's7-1200-robot-holding'
            ? 'S7-1200 RobotHolding selected: HR0..20, joints HR7..12.'
            : 'OpenPLC %QW profile selected: control %QW90..96, joints %QW100..105.',
        } : {}),
        quantity: field === 'dataFormat' ? (value === 'int16-rad-x10000' ? 6 : 12) : current.openPlc.quantity,
        error: undefined,
      },
    }));
  };

  const toggleOpenPlc = () => {
    setPlcDashboard((current) => {
      const enabled = !current.openPlc.enabled;
      let connectionAuthorized = current.openPlc.connectionAuthorized;
      if (enabled && current.openPlc.endpointProfile === 's7-1200-robot-holding' && !connectionAuthorized) {
        const confirmed = window.confirm(`Connect to physical PLC ${current.openPlc.host}:${current.openPlc.port} Unit ${current.openPlc.unitId}? Commands, IoT telemetry and policies can write real holding registers HR0 and HR13..20.`);
        if (!confirmed) return current;
        connectionAuthorized = true;
      }
      if (enabled) plcBridgeDisconnectLockRef.current = true;
      const endpointName = current.openPlc.endpointProfile === 's7-1200-robot-holding' ? 'physical S7-1200 PLC' : 'OpenPLC';
      return {
        ...current,
        running: false,
        localManualActive: false,
        externalBridgeEnabled: enabled ? false : current.externalBridgeEnabled,
        openPlc: { ...current.openPlc, enabled, online: false, autoReconnect: enabled, connectionAuthorized, controlledNodeId: enabled ? selectedKinematicNode?.id : current.openPlc.controlledNodeId, runtimeRunning: undefined, runtimeIssue: undefined, rawRegisters: enabled ? undefined : current.openPlc.rawRegisters, received: enabled ? 0 : current.openPlc.received, error: undefined },
        message: enabled ? `Connecting to ${endpointName} ${current.openPlc.host}:${current.openPlc.port}...` : `${endpointName} disconnected. Internal PLC authority is available.`,
      };
    });
  };

  const probeOpenPlc = async () => {
    const config = plcDashboardRef.current.openPlc;
    const physical = config.endpointProfile === 's7-1200-robot-holding';
    setPlcDashboard((current) => ({ ...current, openPlc: { ...current.openPlc, probing: true, error: undefined, diagnostics: physical ? 'Reading S7-1200 RobotHolding HR0..20...' : 'Scanning ports, Unit IDs and %QW registers...' } }));
    const query = new URLSearchParams({ host: config.host, port: String(config.port), unitId: String(config.unitId), profile: config.endpointProfile });
    try {
      const response = await fetch(`/__openplc/probe?${query.toString()}`, { cache: 'no-store' });
      const payload = await response.json() as { ok?: boolean; port?: number; unitId?: number; address?: number; quantity?: number; dataFormat?: 'int16-rad-x10000'; registers?: number[]; attempts?: Array<{ port: number; unitId: number; result: string }>; error?: string };
      if (!response.ok || !payload.ok) throw new Error(`${payload.error ?? 'OpenPLC probe failed'} (${payload.attempts?.map((item) => `${item.port}/U${item.unitId}: ${item.result}`).join(' | ') ?? 'no response'})`);
      const connectPhysical = physical && window.confirm(`S7-1200 RobotHolding detected at ${config.host}:${payload.port ?? config.port}, Unit ${payload.unitId ?? config.unitId}. Connect now and keep automatic reconnect armed? TwinAxis may write HR0 and HR13..20.`);
      setPlcDashboard((current) => ({
        ...current,
        externalBridgeEnabled: connectPhysical ? false : current.externalBridgeEnabled,
        localManualActive: connectPhysical ? false : current.localManualActive,
        openPlc: { ...current.openPlc, probing: false, enabled: connectPhysical || current.openPlc.enabled, online: false, autoReconnect: connectPhysical || current.openPlc.autoReconnect, connectionAuthorized: connectPhysical || current.openPlc.connectionAuthorized, controlledNodeId: connectPhysical ? selectedKinematicNode?.id : current.openPlc.controlledNodeId, port: payload.port ?? current.openPlc.port, unitId: payload.unitId ?? current.openPlc.unitId, address: payload.address ?? (physical ? 7 : 100), quantity: payload.quantity ?? 6, dataFormat: payload.dataFormat ?? 'int16-rad-x10000', command: payload.registers?.[0] === 1 || payload.registers?.[0] === 2 ? payload.registers[0] : 0, rawRegisters: payload.registers, diagnostics: physical ? (connectPhysical ? 'S7-1200 detected. Continuous FC03 polling and automatic reconnect are active.' : 'Detected S7-1200 RobotHolding HR0..20. Connection was not authorized.') : `Detected %QW90..105. J1-J6 start at wire ${payload.address ?? 100}.` },
        message: physical ? (connectPhysical ? 'Physical S7-1200 connected. HR7..12 now drive both robot views.' : 'Physical PLC detected, but continuous connection was not authorized.') : 'OpenPLC cobot register map detected. Press Connect OpenPLC.',
      }));
    } catch (error) {
      setPlcDashboard((current) => ({ ...current, openPlc: { ...current.openPlc, probing: false, error: error instanceof Error ? error.message : 'PLC probe failed', diagnostics: physical ? 'No valid S7-1200 RobotHolding signature was received at HR0..20.' : 'No valid cobot register signature was received.' } }));
    }
  };

  const testPhysicalPlcConnection = async () => {
    const config = plcDashboardRef.current.openPlc;
    setPlcDashboard((current) => ({ ...current, openPlc: { ...current.openPlc, probing: true, online: false, error: undefined, diagnostics: `Testing FC03 ${config.host}:${config.port} Unit ${config.unitId}, HR0..HR20...` } }));
    try {
      const query = new URLSearchParams({ host: config.host, port: String(config.port), unitId: String(config.unitId), address: '0', quantity: '21', profile: 's7-1200-robot-holding' });
      const response = await fetch(`/__openplc/read?${query.toString()}`, { cache: 'no-store' });
      const payload = await response.json() as { ok?: boolean; registers?: number[]; transactionId?: number; functionCode?: number; receivedAt?: string; error?: string };
      if (!response.ok || !payload.ok || payload.registers?.length !== 21) throw new Error(payload.error ?? `Expected 21 holding registers, received ${payload.registers?.length ?? 0}`);
      setPlcDashboard((current) => ({
        ...current,
        openPlc: {
          ...current.openPlc,
          probing: false,
          online: true,
          rawRegisters: payload.registers,
          received: current.openPlc.received + 1,
          error: undefined,
          diagnostics: `CONNECTED · FC${payload.functionCode ?? 3} · TID ${payload.transactionId ?? '--'} · HR0..HR20 read at ${payload.receivedAt ?? new Date().toISOString()}`,
        },
        message: `Physical PLC connected at ${config.host}:${config.port}, Unit ${config.unitId}.`,
      }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Physical PLC connection test failed';
      setPlcDashboard((current) => ({ ...current, openPlc: { ...current.openPlc, probing: false, online: false, error: detail, diagnostics: `DISCONNECTED · ${detail}` }, message: detail }));
    }
  };

  const testPhysicalPlcHomeReaction = async () => {
    const config = plcDashboardRef.current.openPlc;
    if (!window.confirm(`TEST REAL PLC ${config.host}:${config.port}\n\nThis writes HOME to HR0 and can move a connected robot. Confirm the real cell is safe, guarded and ready. Continue?`)) return;
    const write = async (address: number, values: number[]) => {
      const response = await fetch('/__openplc/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: config.host, port: config.port, unitId: config.unitId, address, values }) });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? `Write HR${address} failed`);
    };
    try {
      setPlcDashboard((current) => ({ ...current, openPlc: { ...current.openPlc, probing: true, error: undefined, diagnostics: 'REACTION TEST · writing HR0=2 (HOME)...' } }));
      await write(0, [2]);
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      const query = new URLSearchParams({ host: config.host, port: String(config.port), unitId: String(config.unitId), address: '0', quantity: '21', profile: 's7-1200-robot-holding' });
      const response = await fetch(`/__openplc/read?${query.toString()}`, { cache: 'no-store' });
      const payload = await response.json() as { ok?: boolean; registers?: number[]; transactionId?: number; error?: string };
      if (!response.ok || !payload.ok || payload.registers?.length !== 21) throw new Error(payload.error ?? 'PLC reaction read failed');
      const [command, status, step] = payload.registers;
      if (command !== 2 || status !== 2 || step !== 0) throw new Error(`HOME not acknowledged: HR0=${command}, HR1=${status}, HR2=${step}`);
      setPlcDashboard((current) => ({ ...current, openPlc: { ...current.openPlc, probing: false, online: true, rawRegisters: payload.registers, received: current.openPlc.received + 1, error: undefined, diagnostics: `REACTION PASS · HR0=2 → HR1=2, HR2=0 · TID ${payload.transactionId ?? '--'} · returning to HOLD` }, message: 'Physical PLC HOME reaction verified. Command returned to HOLD.' }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Physical PLC reaction test failed';
      setPlcDashboard((current) => ({ ...current, openPlc: { ...current.openPlc, probing: false, online: false, error: detail, diagnostics: `REACTION FAIL · ${detail}` }, message: detail }));
    } finally {
      try { await write(0, [0]); } catch { /* The visible failure state already requires operator review. */ }
    }
  };

  const testPhysicalPlcJog = async (direction: 'forward' | 'return') => {
    const config = plcDashboardRef.current.openPlc;
    if (!window.confirm(direction === 'forward'
      ? `STEP REAL PLC ${config.host}:${config.port}\n\nThis writes a small manual increment to HR7..HR12. Confirm the real cell is safe. Continue?`
      : `RETURN REAL PLC ${config.host}:${config.port}\n\nThis restores the exact HR7..HR12 vector captured before the first step. Continue?`)) return;
    const request = async (path: string, options?: RequestInit) => {
      const response = await fetch(path, options);
      const payload = await response.json() as { ok?: boolean; registers?: number[]; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Physical PLC jog request failed');
      return payload;
    };
    const write = (address: number, values: number[]) => request('/__openplc/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: config.host, port: config.port, unitId: config.unitId, address, values }) });
    try {
      setPlcDashboard((current) => ({ ...current, openPlc: { ...current.openPlc, probing: true, error: undefined, diagnostics: direction === 'forward' ? 'STEP · reading HR7..HR12...' : 'RETURN · restoring captured HR7..HR12...' } }));
      const query = new URLSearchParams({ host: config.host, port: String(config.port), unitId: String(config.unitId), address: '0', quantity: '21', profile: 's7-1200-robot-holding' });
      const before = await request(`/__openplc/read?${query.toString()}`, { cache: 'no-store' });
      const currentWords = before.registers!.slice(7, 13);
      if (direction === 'forward' && !physicalPlcJogOriginRef.current) physicalPlcJogOriginRef.current = [...currentWords];
      const signed = (word: number) => (word & 0x8000 ? word - 0x10000 : word);
      const word = (value: number) => Math.max(-32768, Math.min(32767, Math.round(value))) & 0xffff;
      const increments = [175, -120, 140, -100, 90, 120];
      const target = direction === 'return'
        ? physicalPlcJogOriginRef.current
        : currentWords.map((value, index) => word(signed(value) + increments[index]));
      if (!target) throw new Error('No initial PLC joint vector has been captured. Run Step Forward first.');
      await write(0, [0]);
      await write(7, target);
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      const after = await request(`/__openplc/read?${query.toString()}`, { cache: 'no-store' });
      const actual = after.registers!.slice(7, 13);
      if (actual.some((value, index) => value !== target[index])) throw new Error(`PLC did not retain the requested joint vector. Expected [${target.join(', ')}], read [${actual.join(', ')}].`);
      if (direction === 'return') physicalPlcJogOriginRef.current = undefined;
      setPlcDashboard((current) => ({ ...current, openPlc: { ...current.openPlc, probing: false, online: true, rawRegisters: after.registers, received: current.openPlc.received + 1, diagnostics: `${direction === 'forward' ? 'STEP PASS' : 'RETURN PASS'} · HR7..HR12 [${actual.join(', ')}] · HR0=0 manual hold`, error: undefined }, message: direction === 'forward' ? 'Small PLC joint step verified. Use Return to Start to restore the captured vector.' : 'PLC joints returned to the captured start vector.' }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Physical PLC jog failed';
      setPlcDashboard((current) => ({ ...current, openPlc: { ...current.openPlc, probing: false, error: detail, diagnostics: `JOG FAIL · ${detail}` }, message: detail }));
    }
  };

  const togglePhysicalPlcStartDemo = async () => {
    if (physicalPlcDemoTimerRef.current !== undefined) {
      window.clearTimeout(physicalPlcDemoTimerRef.current);
      physicalPlcDemoTimerRef.current = undefined;
      physicalPlcDemoRunIdRef.current += 1;
      physicalPlcDemoWriteInFlightRef.current = false;
      setPhysicalPlcDemoActive(false);
      setPlcDashboard((current) => ({ ...current, message: 'Physical PLC Start Demo stopped. HR0 remains in manual hold.' }));
      return;
    }

    const config = plcDashboardRef.current.openPlc;
    const node = document.nodes.find((candidate) => candidate.id === config.controlledNodeId) ?? selectedKinematicNode;
    const graph = node ? graphFromGeometry(node.geometry) : undefined;
    const clip = graph?.motionClips?.find((candidate) => /pick|place|ciclo/i.test(candidate.name)) ?? graph?.motionClips?.[0];
    const joints = graph?.joints.filter((joint) => joint.type !== 'fixed').slice(0, 6) ?? [];
    if (config.endpointProfile !== 's7-1200-robot-holding' || !config.enabled || !config.online) {
      setPlcDashboard((current) => ({ ...current, message: 'Connect the Physical S7-1200 profile before running Start Demo.' }));
      return;
    }
    if (!node || !graph || !clip || joints.length === 0) {
      setPlcDashboard((current) => ({ ...current, message: 'The controlled robot has no kinematic Start Demo clip.' }));
      return;
    }
    if (!window.confirm(`RUN START DEMO ON REAL PLC ${config.host}:${config.port}\n\nTwinAxis will blend from the current PLC pose and stream the robot clip to HR7..HR12 at up to 20 Hz. Confirm the physical cell is clear, guarded and ready.`)) return;

    const write = async (address: number, values: number[]) => enqueuePhysicalPlcIo(async () => {
      const response = await fetch('/__openplc/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: config.host, port: config.port, unitId: config.unitId, address, values }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? `Write HR${address} failed`);
    });
    const encode = (value: number) => Math.max(-32768, Math.min(32767, Math.round(value * 10000))) & 0xffff;
    const homeValues = createHomeKinematicState(graph).homeJointValues;
    const initialValues = Object.fromEntries(joints.map((joint, index) => [
      joint.id,
      config.rawRegisters?.[index] !== undefined ? decodeOpenPlcInt16(config.rawRegisters[index]) / 10000 : homeValues[joint.id] ?? 0,
    ]));
    const runId = physicalPlcDemoRunIdRef.current + 1;
    physicalPlcDemoRunIdRef.current = runId;
    const frameStepSeconds = 0.05;
    const leadInSeconds = 1.2;
    let trajectoryElapsed = 0;

    try {
      await write(0, [0]);
      setPhysicalPlcDemoActive(true);
      setPlcDashboard((current) => ({
        ...current,
        openPlc: { ...current.openPlc, command: 0, diagnostics: `START DEMO · ${clip.name} · ${joints.length} joints · HR7..HR${6 + joints.length}` },
        message: `Physical PLC is reproducing the same ${clip.name} clip used by Start Demo.`,
      }));
      const sendFrame = async () => {
        if (runId !== physicalPlcDemoRunIdRef.current || physicalPlcDemoWriteInFlightRef.current) return;
        physicalPlcDemoWriteInFlightRef.current = true;
        try {
          const clipElapsed = Math.max(0, trajectoryElapsed - leadInSeconds);
          const sampled = sampleKinematicMotionClip(clip, clipElapsed);
          const leadInTarget = sampleKinematicMotionClip(clip, 0);
          const leadInProgress = Math.min(1, trajectoryElapsed / leadInSeconds);
          const smoothLeadIn = leadInProgress * leadInProgress * (3 - 2 * leadInProgress);
          const jointValues = Object.fromEntries(joints.map((joint) => {
            const clipValue = sampled[joint.id] ?? homeValues[joint.id] ?? 0;
            const requested = trajectoryElapsed < leadInSeconds
              ? (initialValues[joint.id] ?? 0) + ((leadInTarget[joint.id] ?? homeValues[joint.id] ?? 0) - (initialValues[joint.id] ?? 0)) * smoothLeadIn
              : clipValue;
            const bounded = joint.limits
              ? Math.max(joint.limits.lower ?? -Infinity, Math.min(joint.limits.upper ?? Infinity, requested))
              : requested;
            return [joint.id, bounded];
          }));
          const words = joints.map((joint) => {
            return encode(jointValues[joint.id] ?? 0);
          });
          await write(7, words);
          if (runId !== physicalPlcDemoRunIdRef.current) return;
          setExternalPlcRuntimePose({ nodeId: node.id, jointValues });
          trajectoryElapsed += frameStepSeconds;
          if (!clip.loop && clipElapsed >= clip.duration) {
            if (physicalPlcDemoTimerRef.current !== undefined) window.clearTimeout(physicalPlcDemoTimerRef.current);
            physicalPlcDemoTimerRef.current = undefined;
            setPhysicalPlcDemoActive(false);
            setPlcDashboard((current) => ({ ...current, message: `Physical PLC completed ${clip.name}. Final pose is held in HR7..HR12.` }));
          } else {
            physicalPlcDemoTimerRef.current = window.setTimeout(() => void sendFrame(), 50);
          }
        } catch (error) {
          if (physicalPlcDemoTimerRef.current !== undefined) window.clearTimeout(physicalPlcDemoTimerRef.current);
          physicalPlcDemoTimerRef.current = undefined;
          setPhysicalPlcDemoActive(false);
          const detail = error instanceof Error ? error.message : 'Physical PLC Start Demo write failed';
          setPlcDashboard((current) => ({ ...current, openPlc: { ...current.openPlc, diagnostics: `START DEMO FAILED · ${detail}` }, message: detail }));
        } finally {
          physicalPlcDemoWriteInFlightRef.current = false;
        }
      };
      await sendFrame();
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Physical PLC Start Demo could not start';
      setPhysicalPlcDemoActive(false);
      setPlcDashboard((current) => ({ ...current, openPlc: { ...current.openPlc, diagnostics: `START DEMO FAILED · ${detail}` }, message: detail }));
    }
  };

  const writeOpenPlcCommand = async (command: 0 | 1 | 2) => {
    const config = plcDashboardRef.current.openPlc;
    const commandWire = configuredPlcWire(config, 'system-command', 90);
    if (!config.enabled) {
      setPlcDashboard((current) => ({ ...current, message: 'Connect OpenPLC before selecting a robot operating mode.' }));
      return;
    }
    setPlcDashboard((current) => ({
      ...current,
      openPlc: { ...current.openPlc, error: undefined, diagnostics: `Writing command ${command} to wire ${commandWire}...` },
    }));
    try {
      const response = await fetch('/__openplc/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: config.host, port: config.port, unitId: config.unitId, address: commandWire, values: [command] }),
      });
      const payload = await response.json() as { ok?: boolean; functionCode?: number; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'OpenPLC command write failed');
      const labels = ['MANUAL / HOLD', 'AUTO', 'HOME'] as const;
      setPlcDashboard((current) => ({
        ...current,
        localManualActive: false,
        openPlc: { ...current.openPlc, command, diagnostics: `FC${payload.functionCode ?? 6} wire ${commandWire} = ${command} (${labels[command]}).` },
        message: `OpenPLC robot mode: ${labels[command]}.`,
      }));
      setStatus(`OpenPLC ${labels[command]}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'OpenPLC command write failed';
      setPlcDashboard((current) => ({ ...current, openPlc: { ...current.openPlc, error: detail, diagnostics: detail }, message: detail }));
    }
  };

  const activateLocalManualControl = () => {
    if (!selectedKinematicNode) {
      setPlcDashboard((current) => ({ ...current, message: 'Select a robot with a KinematicGraph before enabling local manual control.' }));
      return;
    }

    plcBridgeDisconnectLockRef.current = true;
    const sequence = plcDashboardRef.current.sequence + 1;
    const project = createConfiguredPlcProject(selectedKinematicNode);
    const frame = runPlcModbusSimulationFrame(selectedKinematicNode, {
      project,
      elapsedSeconds: 0,
      sequence,
      nowMs: Date.now(),
      registerOverrides: {},
    });
    setKinematicJointValuesForNode(selectedKinematicNode.id, frame.jointValues);
    setPlcDashboard((current) => ({
      ...current,
      running: false,
      localManualActive: true,
      externalBridgeEnabled: false,
      externalBridgeOnline: false,
      externalBridgeClientConnected: false,
      project: frame.project,
      frame,
      frameNodeId: selectedKinematicNode.id,
      sequence,
      registerOverrides: Object.fromEntries(frame.physicalRegisters.map((register) => [register.signalId, register.value])),
      openPlc: {
        ...current.openPlc,
        enabled: false,
        online: false,
        command: 0,
        error: undefined,
        diagnostics: 'Local PLC owns J1-J6. OpenPLC polling and the external Modbus controller are disconnected.',
      },
      message: `LOCAL MANUAL active: ${frame.physicalRegisters.length} joint controls loaded from ${selectedKinematicNode.name}.`,
    }));
    setStatus(`Local manual PLC: ${frame.physicalRegisters.length} joints`);
  };

  const writeOpenPlcSensorPolicy = async (sensorPolicy: 0 | 1) => {
    const config = plcDashboardRef.current.openPlc;
    const policyWire = configuredPlcWire(config, 'iot-policy', 127);
    const commandWire = configuredPlcWire(config, 'system-command', 90);
    if (!config.enabled) {
      setPlcDashboard((current) => ({ ...current, message: 'Connect OpenPLC before changing the IoT policy.' }));
      return;
    }
    try {
      const response = await fetch('/__openplc/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: config.host, port: config.port, unitId: config.unitId, address: policyWire, values: [sensorPolicy] }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'IoT policy write failed');
      {
        const commandResponse = await fetch('/__openplc/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: config.host, port: config.port, unitId: config.unitId, address: commandWire, values: [1] }),
        });
        const commandPayload = await commandResponse.json() as { ok?: boolean; error?: string };
        if (!commandResponse.ok || !commandPayload.ok) throw new Error(commandPayload.error ?? 'AUTO command write failed');
      }
      setPlcDashboard((current) => ({
        ...current,
        localManualActive: sensorPolicy === 1 ? false : current.localManualActive,
        openPlc: { ...current.openPlc, sensorPolicy, command: 1 },
        message: sensorPolicy === 1
          ? `Motion permit active: ${config.endpointProfile === 's7-1200-robot-holding' ? 'HR20' : '%QW127'}=1 and AUTO ${config.endpointProfile === 's7-1200-robot-holding' ? `HR${commandWire}` : `%QW${commandWire}`}=1. Move the IoT sensor to release HOLD.`
          : `Condition monitor active: ${config.endpointProfile === 's7-1200-robot-holding' ? 'HR20' : '%QW127'}=0 and AUTO=1. The robot cycle is independent of IoT motion unless telemetry reaches warning/trip limits.`,
      }));
      setStatus(sensorPolicy === 1 ? 'IoT motion permit armed in AUTO' : 'IoT condition monitor enabled');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'IoT policy write failed';
      setPlcDashboard((current) => ({ ...current, openPlc: { ...current.openPlc, error: detail }, message: detail }));
    }
  };

  const pollOpenPlc = useCallback(async () => {
    const current = plcDashboardRef.current;
    if (!current.openPlc.enabled || openPlcPollInFlightRef.current) return;
    const plcNode = document.nodes.find((node) => node.id === current.openPlc.controlledNodeId && Boolean(graphFromGeometry(node.geometry)));
    if (!plcNode) return;
    openPlcPollInFlightRef.current = true;
    const config = current.openPlc;
    const physicalEndpoint = config.endpointProfile === 's7-1200-robot-holding';
    const configuredJointCapacity = config.dataFormat === 'float32-be' ? Math.max(1, Math.floor(config.quantity / 2)) : Math.max(1, config.quantity);
    const selectedJointIds = new Set(graphFromGeometry(plcNode.geometry)?.joints.map((joint) => joint.id) ?? []);
    const enabledJointDefinitions = registerConfiguration.filter((entry) => entry.enabled && entry.role === 'joint' && entry.jointId);
    const registerWindowEnd = config.address + config.quantity;
    const fitsOpenPlcWindow = (entry: InternalRegisterDefinition) =>
      entry.wire >= config.address && entry.wire + registerWordCount(entry.encoding) <= registerWindowEnd;
    const movableJoints = graphFromGeometry(plcNode.geometry)?.joints.filter((joint) => joint.type !== 'fixed') ?? [];
    const requiredJointCount = Math.min(configuredJointCapacity, movableJoints.length);
    const allNodeJointDefinitions = enabledJointDefinitions
      .filter((entry) => entry.robotNodeId === plcNode.id)
      .sort((a, b) => a.wire - b.wire);
    const allPersistentJointDefinitions = enabledJointDefinitions
      .filter((entry) => entry.jointId && selectedJointIds.has(entry.jointId))
      .sort((a, b) => a.wire - b.wire);
    const rebasePhysicalDefinitions = (definitions: InternalRegisterDefinition[]) => definitions
      .slice(0, configuredJointCapacity)
      .map((entry, index) => ({
        ...entry,
        wire: config.address + index,
        encoding: 'int16-rad-x10000' as RegisterEncoding,
      }));
    const nodeJointDefinitions = config.endpointProfile === 's7-1200-robot-holding'
      ? rebasePhysicalDefinitions(allNodeJointDefinitions)
      : allNodeJointDefinitions.filter(fitsOpenPlcWindow);
    const persistentJointDefinitions = config.endpointProfile === 's7-1200-robot-holding'
      ? rebasePhysicalDefinitions(allPersistentJointDefinitions)
      : allPersistentJointDefinitions.filter(fitsOpenPlcWindow);
    // Several robots can reuse one physical PLC profile. Ignore stale per-robot
    // addresses outside the active OpenPLC block instead of reading static HRs.
    const storedJointDefinitions = nodeJointDefinitions.length >= requiredJointCount
      ? nodeJointDefinitions
      : persistentJointDefinitions.length >= requiredJointCount
        ? persistentJointDefinitions
        : [];
    const generatedJointDefinitions: InternalRegisterDefinition[] = storedJointDefinitions.length
      ? []
      : movableJoints.map((joint, index) => ({
          id: `runtime-${plcNode.id}-${joint.id}`,
          wire: config.address + index * (config.dataFormat === 'float32-be' ? 2 : 1),
          semantic: `${plcNode.name} / ${joint.name}`,
          encoding: config.dataFormat,
          access: 'plc-to-platform',
          enabled: true,
          role: 'joint',
          robotNodeId: plcNode.id,
          jointId: joint.id,
        }));
    const jointDefinitions = [...storedJointDefinitions, ...generatedJointDefinitions]
      .sort((a, b) => a.wire - b.wire)
      .slice(0, configuredJointCapacity);
    const jointStart = jointDefinitions.length ? Math.min(...jointDefinitions.map((entry) => entry.wire)) : config.address;
    const jointEnd = jointDefinitions.length ? Math.max(...jointDefinitions.map((entry) => entry.wire + registerWordCount(entry.encoding))) : config.address + config.quantity;
    const query = new URLSearchParams({
      host: config.host,
      port: String(config.port),
      unitId: String(config.unitId),
      address: String(physicalEndpoint ? 0 : jointStart),
      quantity: String(physicalEndpoint ? 21 : Math.max(1, jointEnd - jointStart)),
      profile: config.endpointProfile,
    });
    try {
      const statusIds = ['system-command', 'system-status', 'system-step', 'system-time', 'system-alarm', 'system-condition', 'system-speed'];
      const statusWireMap = config.endpointProfile === 's7-1200-robot-holding' ? physicalPlcWire : documentedOpenPlcWire;
      const statusDefinitions = statusIds.map((id) => ({ id, wire: statusWireMap[id], encoding: 'uint16' as RegisterEncoding }));
      const statusStart = statusDefinitions.length ? Math.min(...statusDefinitions.map((entry) => entry.wire)) : 90;
      const statusEnd = statusDefinitions.length ? Math.max(...statusDefinitions.map((entry) => entry.wire + registerWordCount(entry.encoding))) : 97;
      const policyWire = configuredPlcWire(config, 'iot-policy', 127);
      const statusQuery = new URLSearchParams({ host: config.host, port: String(config.port), unitId: String(config.unitId), address: String(statusStart), quantity: String(statusEnd - statusStart), profile: config.endpointProfile });
      const policyQuery = new URLSearchParams({ host: config.host, port: String(config.port), unitId: String(config.unitId), address: String(policyWire), quantity: '1', profile: config.endpointProfile });
      type ReadPayload = { ok?: boolean; registers?: number[]; receivedAt?: string; error?: string };
      const readRegisters = async (requestQuery: URLSearchParams) => {
        const response = await fetch(`/__openplc/read?${requestQuery.toString()}`, { cache: 'no-store' });
        const payload = await response.json() as ReadPayload;
        if (!response.ok || !payload.ok || !payload.registers) throw new Error(payload.error ?? 'Modbus read failed');
        return payload;
      };
      let payload: ReadPayload;
      let statusPayload: ReadPayload;
      let policyPayload: ReadPayload;
      if (physicalEndpoint) {
        const processImage = await enqueuePhysicalPlcIo(() => readRegisters(query));
        const registers = processImage.registers!;
        payload = { ...processImage, registers: registers.slice(jointStart, jointEnd) };
        statusPayload = { ...processImage, registers: registers.slice(statusStart, statusEnd) };
        policyPayload = { ...processImage, registers: [registers[policyWire] ?? 0] };
      } else {
        [payload, statusPayload, policyPayload] = await Promise.all([
          readRegisters(query),
          readRegisters(statusQuery),
          readRegisters(policyQuery),
        ]);
      }
      if (!plcDashboardRef.current.openPlc.enabled || plcDashboardRef.current.localManualActive) return;
      const rawRegisters = payload.registers!;
      const project = current.frameNodeId === plcNode.id && current.project
        ? current.project
        : createConfiguredPlcProject(plcNode);
      const template = current.frameNodeId === plcNode.id && current.frame
        ? current.frame
        : runPlcModbusSimulationFrame(plcNode, { project, elapsedSeconds: 0, sequence: current.sequence + 1, nowMs: Date.now() });
      const overrides = Object.fromEntries(template.physicalRegisters.map((register) => {
        const definition = jointDefinitions.find((entry) => entry.jointId === register.jointId);
        const wire = definition?.wire ?? register.address;
        const encoding = definition?.encoding ?? config.dataFormat;
        const offset = Math.max(0, wire - jointStart);
        const value = encoding === 'float32-be'
          ? decodeOpenPlcFloat32(rawRegisters[offset] ?? 0, rawRegisters[offset + 1] ?? 0)
          : encoding === 'int16-rad-x10000'
            ? decodeOpenPlcInt16(rawRegisters[offset] ?? 0) / 10000
            : encoding === 'int16'
              ? decodeOpenPlcInt16(rawRegisters[offset] ?? 0)
              : rawRegisters[offset] ?? 0;
        return [register.signalId, value];
      }));
      const statusValue = (id: string) => {
        const definition = statusDefinitions.find((entry) => entry.id === id);
        return definition ? statusPayload.registers?.[definition.wire - statusStart] : undefined;
      };
      const commandValue = statusValue('system-command') === 1 || statusValue('system-command') === 2 ? statusValue('system-command') as 1 | 2 : 0;
      const statusCode = statusValue('system-status');
      const elapsedMs = statusValue('system-time');
      const conditionCode = statusValue('system-condition');
      const nowMs = Date.now();
      const probe = openPlcExecutionProbeRef.current;
      if (probe.command !== commandValue) {
        probe.command = commandValue;
        probe.elapsedMs = elapsedMs;
        probe.lastProgressAt = nowMs;
      }
      const expectedStaticState = (commandValue === 0 && statusCode === 0) || (commandValue === 2 && statusCode === 2) || (commandValue === 1 && (conditionCode ?? 0) >= 2 && statusCode === 3);
      const scanProgressed = expectedStaticState || (commandValue === 1 && elapsedMs !== undefined && elapsedMs !== probe.elapsedMs);
      if (scanProgressed) probe.lastProgressAt = nowMs;
      probe.elapsedMs = elapsedMs;
      const runtimeGraceMs = Math.max(2000, config.pollMs * 6);
      // RobotHolding has no dedicated scan heartbeat. A static ElapsedMs or pose
      // is a valid process state and cannot be used to declare a physical CPU stopped.
      const runtimeRunning = physicalEndpoint || scanProgressed || nowMs - probe.lastProgressAt < runtimeGraceMs;
      const runtimeIssue = runtimeRunning
        ? undefined
        : `Modbus responds, but the OpenPLC scan is not advancing. Command=${commandValue}, Status=${statusCode ?? '--'}, ElapsedMs=${elapsedMs ?? '--'}. Upload the POU and press Start PLC.`;
      const frame = runPlcDashboardFrame(plcNode, 0, current.sequence + 1, project, overrides, false);
      openPlcFailureCountRef.current = 0;
      setExternalPlcRuntimePose({ nodeId: plcNode.id, jointValues: { ...frame.jointValues } });
      setPlcDashboard((state) => ({
        ...state,
        running: commandValue === 1 && (conditionCode ?? 0) < 2 && runtimeRunning,
        registerOverrides: overrides,
        project: frame.project,
        frame,
        sequence: state.sequence + 1,
        openPlc: {
          ...state.openPlc,
          online: true,
          runtimeRunning,
          runtimeIssue,
          received: state.openPlc.received + 1,
          lastReceivedAt: payload.receivedAt ?? new Date().toISOString(),
          rawRegisters,
          command: commandValue,
          status: statusCode, activeStep: statusValue('system-step'), elapsedMs,
          alarmCode: statusValue('system-alarm'), conditionState: conditionCode, speedPermille: statusValue('system-speed'),
          sensorPolicy: policyPayload.registers?.[0] === 1 ? 1 : 0,
          diagnostics: runtimeIssue ?? (physicalEndpoint
            ? `Physical Modbus FC03 online. HR ${jointStart}-${jointEnd - 1}, ${rawRegisters.length} words received. RobotHolding does not expose a dedicated CPU-scan heartbeat.`
            : `Modbus FC03 and OpenPLC scan active. Wires ${jointStart}-${jointEnd - 1}, ${rawRegisters.length} words received.`), error: undefined,
        },
        frameNodeId: plcNode.id,
        message: runtimeIssue ?? `${physicalEndpoint ? 'Physical PLC ONLINE' : 'OpenPLC RUNNING'}: ${payload.registers!.length} holding registers reflected in the digital twin.`,
      }));
    } catch (error) {
      if (!plcDashboardRef.current.openPlc.enabled || plcDashboardRef.current.localManualActive) return;
      const detail = error instanceof Error ? error.message : 'OpenPLC read failed';
      const physicalEndpoint = config.endpointProfile === 's7-1200-robot-holding';
      const message = /ECONNREFUSED|connect failed|socket/i.test(detail)
        ? physicalEndpoint
          ? `Physical PLC ${config.host}:${config.port} is unreachable. Keep reconnect armed and verify the OT network, S7-1200 IP and MB_SERVER.`
          : `OpenPLC Modbus port ${config.host}:${config.port} is closed. Upload the PLC program, set Runtime to RUNNING and verify the Modbus Slave plugin.`
        : /exception 2|illegal data address/i.test(detail)
          ? `${physicalEndpoint ? 'Physical PLC' : 'OpenPLC'} answered, but configured register ${jointStart} is not mapped. Review the active RobotHolding map.`
          : `${physicalEndpoint ? 'Physical PLC' : 'OpenPLC'} communication failed: ${detail}`;
      const consecutiveFailures = openPlcFailureCountRef.current + 1;
      openPlcFailureCountRef.current = consecutiveFailures;
      if (physicalEndpoint && consecutiveFailures < 12) {
        // Keep the last confirmed process image and layout stable while the
        // S7-1200 recovers from short single-port Modbus interruptions.
        return;
      }
      setPlcDashboard((state) => ({ ...state, openPlc: { ...state.openPlc, online: false, runtimeRunning: false, runtimeIssue: message, rawRegisters: undefined, error: undefined, diagnostics: message }, message }));
    } finally {
      openPlcPollInFlightRef.current = false;
    }
  }, [createConfiguredPlcProject, document.nodes, enqueuePhysicalPlcIo, registerConfiguration, runPlcDashboardFrame]);

  useEffect(() => {
    pollOpenPlcRef.current = pollOpenPlc;
  }, [pollOpenPlc]);

  useEffect(() => {
    if (!plcDashboard.openPlc.enabled) return undefined;
    void pollOpenPlcRef.current();
    const timer = window.setInterval(() => void pollOpenPlcRef.current(), Math.max(100, plcDashboard.openPlc.pollMs));
    return () => window.clearInterval(timer);
  }, [plcDashboard.openPlc.enabled, plcDashboard.openPlc.pollMs]);

  useEffect(() => {
    if (plcDashboard.openPlc.enabled) return undefined;
    if (physicalPlcDemoTimerRef.current !== undefined) window.clearTimeout(physicalPlcDemoTimerRef.current);
    physicalPlcDemoTimerRef.current = undefined;
    physicalPlcDemoRunIdRef.current += 1;
    physicalPlcDemoWriteInFlightRef.current = false;
    setPhysicalPlcDemoActive(false);
    return undefined;
  }, [plcDashboard.openPlc.enabled]);

  const togglePlcDashboardAdvanced = () => {
    setPlcDashboard((current) => ({ ...current, advanced: !current.advanced }));
  };

  const openModbusController = async () => {
    setTraceAuditDrawerOpen(false);
    setModbusControllerDrawerOpen(true);
    if (modbusControllerUrl || modbusControllerLaunching) return;
    setModbusControllerLaunching(true);
    setStatus('Starting Modbus Controller on 127.0.0.1:8765...');
    try {
      const response = await fetch('/__modbus-controller/start', { method: 'POST' });
      const payload = await response.json() as { ok?: boolean; url?: string; error?: string };
      if (!response.ok || !payload.ok || !payload.url) throw new Error(payload.error ?? 'Modbus Controller could not be started.');
      setModbusControllerUrl(`${payload.url}/?embedded=1`);
      setStatus(`Modbus Controller ready in the integrated panel: ${payload.url}`);
    } catch (error) {
      setModbusControllerDrawerOpen(false);
      setStatus(error instanceof Error ? error.message : 'Modbus Controller could not be started.');
    } finally {
      setModbusControllerLaunching(false);
    }
  };

  const openTraceAudit = async () => {
    if (!modbusControllerUrl && !modbusControllerLaunching) await openModbusController();
    setModbusControllerDrawerOpen(false);
    setTraceAuditDrawerOpen(true);
  };

  const applyRegisterDefinitions = (definitions: InternalRegisterDefinition[]) => {
    setRegisterConfiguration(definitions);
    setPlcDashboard((current) => ({ ...current, running: false, project: undefined, frame: undefined, message: 'Confirmed register map saved. PLC bindings will be rebuilt from the approved configuration.' }));
    setStatus('Internal PLC configuration confirmed and saved');
  };

  const applyConnectionProfiles = (profiles: ConnectionProfile[]) => {
    setConnectionProfiles(profiles);
    setStatus('Industrial connection profiles confirmed and saved');
  };

  const connectIndustrialProfile = async (profile: ConnectionProfile) => {
    if (profile.protocol === 'modbus') {
      setStatus('Modbus is managed by the OpenPLC panel. Use Connect OpenPLC to establish the transport.');
      return;
    }
    const manager = connectionManagerRef.current;
    const adapter = profile.protocol === 'mqtt'
      ? new MqttAdapter({ connectionId: profile.id, endpoint: profile.endpoint })
      : profile.protocol === 'opcua'
        ? new OpcUaGatewayAdapter({
          connectionId: profile.id,
          gatewayUrl: profile.endpoint,
          endpointUrl: String(profile.metadata.endpointUrl ?? 'opc.tcp://127.0.0.1:4840'),
          securityPolicy: String(profile.metadata.securityPolicy ?? 'None'),
        })
        : undefined;
    if (!adapter) {
      setStatus(`${profile.protocol.toUpperCase()} does not have a browser adapter in this release.`);
      return;
    }
    try {
      const existing = manager.get(profile.id);
      if (existing && existing.health.state === 'ONLINE') await manager.disconnect(profile.id);
      if (existing) manager.remove(profile.id);
      manager.add(profile, adapter);
      setConnectionHealth((current) => ({ ...current, [profile.id]: { connectionId: profile.id, protocol: profile.protocol, state: 'CONNECTING', quality: 'UNCERTAIN', updatedAtUtc: new Date().toISOString(), message: 'Connection test in progress' } }));
      const result = await manager.connect(profile.id);
      setConnectionHealth((current) => ({ ...current, [profile.id]: result.health }));
      setStatus(`${profile.name}: ${result.health.state}${result.health.message ? ` - ${result.health.message}` : ''}`);
    } catch (error) {
      const health: ConnectionHealth = { connectionId: profile.id, protocol: profile.protocol, state: 'FAILED', quality: 'BAD', updatedAtUtc: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) };
      setConnectionHealth((current) => ({ ...current, [profile.id]: health }));
      setStatus(`${profile.name}: ${health.message}`);
    }
  };

  const disconnectIndustrialProfile = async (profile: ConnectionProfile) => {
    if (profile.protocol === 'modbus') {
      setStatus('Disconnect Modbus from the OpenPLC panel.');
      return;
    }
    try {
      const manager = connectionManagerRef.current;
      const result = manager.get(profile.id) ? await manager.disconnect(profile.id) : undefined;
      const health = result?.health ?? { connectionId: profile.id, protocol: profile.protocol, state: 'DISCONNECTED' as const, quality: 'COMM_LOST' as const, updatedAtUtc: new Date().toISOString(), message: 'Disconnected' };
      setConnectionHealth((current) => ({ ...current, [profile.id]: health }));
      setStatus(`${profile.name}: disconnected`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  type TerminalModbusPayload = {
    sequence?: number;
    timestampUtc?: string;
    controllerEndpoint?: {
      host?: string;
      port?: string | number;
      stateUrl?: string;
      writeUrl?: string;
    };
    client?: {
      ip?: string;
      port?: string | number;
    };
    connectedClients?: Array<{
      id?: string;
      ip?: string;
      port?: string | number;
      endpoint?: string;
      connectedAtUtc?: string;
      lastSeenUtc?: string;
    }>;
    stateReaders?: Array<{
      id?: string;
      kind?: string;
      ip?: string;
      port?: string | number;
      connectedAtUtc?: string;
      lastSeenUtc?: string;
    }>;
    registers?: Array<{
      address?: number;
      displayAddress?: string;
      signalId?: string;
      jointId?: string;
      jointName?: string;
      value?: number;
      registers?: number[];
    }>;
    modbusPackets?: PlcSimulationFrame['modbusPackets'];
    iotTelemetry?: {
      valid?: boolean;
      temperatureC?: number;
      humidityPercent?: number;
      gyroDps?: number;
      accelX?: number;
      accelY?: number;
      accelZ?: number;
      gyroX?: number;
      gyroY?: number;
      gyroZ?: number;
      magX?: number;
      magY?: number;
      magZ?: number;
      hasAcceleration?: boolean;
      hasGyroscope?: boolean;
      hasMagnetometer?: boolean;
      hasEnvironment?: boolean;
      ageMs?: number;
      source?: string;
      sequence?: number;
      sampleId?: string;
      quality?: string;
      sourceTimestampUtc?: string;
      receivedAtUtc?: string;
    };
  };

  const applyTerminalModbusPayload = useCallback(
    (payload: TerminalModbusPayload, bridgeUrl: string) => {
      if (plcBridgeDisconnectLockRef.current) return;
      const endpoint = parseModbusBridgeEndpoint(bridgeUrl);
      const receivedAt = payload.timestampUtc ?? new Date().toISOString();
      const activeClient = payload.connectedClients?.[0];
      const activeReader = payload.stateReaders?.[0];
      const clientIp = activeClient?.ip ?? activeReader?.ip ?? payload.client?.ip ?? payload.controllerEndpoint?.host ?? endpoint.host;
      if (!selectedKinematicNode) {
        setPlcDashboard((current) => ({
          ...current,
          open: true,
          externalBridgeOnline: true,
          externalBridgeServerOnline: true,
          externalBridgeClientConnected: Boolean(activeClient || activeReader),
          externalBridgeDisconnectedByUser: false,
          externalBridgeClientId: activeClient?.id,
          externalBridgeClientIp: clientIp,
          externalBridgeClientPort: activeClient?.port ?? activeReader?.port ?? payload.client?.port,
          externalBridgeLastReceivedAt: receivedAt,
          message: 'Visual Modbus controller online. Select a kinematic robot to reflect registers into the twin.',
        }));
        return;
      }
      const current = plcDashboardRef.current;
      const overrides = Object.fromEntries(
        (payload.registers ?? [])
          .filter((register) => Number.isFinite(register.value))
          .flatMap((register) => {
            const value = Number(register.value);
            return [
              register.displayAddress ? [register.displayAddress, value] : undefined,
              register.signalId ? [register.signalId, value] : undefined,
              register.jointId ? [register.jointId, value] : undefined,
            ].filter(Boolean) as Array<[string, number]>;
          }),
      );
      const project = current.frameNodeId === selectedKinematicNode.id && current.project
        ? current.project
        : createConfiguredPlcProject(selectedKinematicNode, payload.timestampUtc ?? new Date().toISOString());
      const frame = runPlcDashboardFrame(selectedKinematicNode, 0, Number(payload.sequence ?? current.sequence + 1), project, overrides, false);
      setExternalPlcRuntimePose({ nodeId: selectedKinematicNode.id, jointValues: { ...frame.jointValues } });
      const byDisplayAddress = new Map((payload.registers ?? []).map((register) => [register.displayAddress, register]));
      const byIndex = payload.registers ?? [];
      const physicalRegisters = frame.physicalRegisters.map((register, index) => {
        const external = byDisplayAddress.get(register.displayAddress) ?? byIndex[index];
        if (!external || !Number.isFinite(external.value)) return register;
        return {
          ...register,
          address: external.address ?? register.address,
          displayAddress: external.displayAddress ?? register.displayAddress,
          jointName: external.jointName ?? register.jointName,
          value: Number(external.value),
          registers: external.registers ?? register.registers,
        };
      });
      const nextFrame: PlcSimulationFrame = {
        ...frame,
        physicalRegisters,
        modbusPackets: payload.modbusPackets?.length ? payload.modbusPackets : frame.modbusPackets,
      };
      setPlcDashboard((state) => ({
        ...state,
        open: true,
        running: false,
        externalBridgeEnabled: true,
        externalBridgeOnline: true,
        externalBridgeServerOnline: true,
        externalBridgeClientConnected: Boolean(activeClient || activeReader),
        externalBridgeDisconnectedByUser: false,
        externalBridgeUrl: bridgeUrl,
        externalBridgeClientId: activeClient?.id,
        externalBridgeClientIp: clientIp,
        externalBridgeClientPort: activeClient?.port ?? activeReader?.port ?? payload.client?.port,
        externalBridgeLastReceivedAt: receivedAt,
        registerOverrides: overrides,
        project: nextFrame.project,
        frame: nextFrame,
        frameNodeId: selectedKinematicNode.id,
        sequence: Number(payload.sequence ?? frame.samples[0]?.sequence ?? state.sequence + 1),
        message: `Visual Modbus controller online: ${(payload.registers ?? []).length} HR values reflected in digital twin.`,
      }));
    },
    [runPlcDashboardFrame, selectedKinematicNode],
  );

  const applyTerminalBridgeHealth = useCallback((payload: TerminalModbusPayload, bridgeUrl: string) => {
    const endpoint = parseModbusBridgeEndpoint(bridgeUrl);
    const activeClient = payload.connectedClients?.[0];
    const activeReader = payload.stateReaders?.[0];
    if (plcBridgeDisconnectLockRef.current) {
      setPlcDashboard((current) => {
        if (!activeClient) {
          if (current.externalBridgeDisconnectedByUser) plcBridgeReconnectArmedRef.current = true;
          return {
            ...current,
            externalBridgeServerOnline: true,
            externalBridgeOnline: false,
            externalBridgeClientConnected: false,
            externalBridgeClientId: undefined,
            externalBridgeClientIp: undefined,
            externalBridgeClientPort: undefined,
          };
        }
        if (!current.externalBridgeDisconnectedByUser || !plcBridgeReconnectArmedRef.current) {
          return { ...current, externalBridgeServerOnline: true };
        }
        plcBridgeDisconnectLockRef.current = false;
        plcBridgeReconnectArmedRef.current = false;
        return {
          ...current,
          externalBridgeEnabled: true,
          externalBridgeDisconnectedByUser: false,
          externalBridgeServerOnline: true,
          externalBridgeClientConnected: true,
          externalBridgeClientId: activeClient.id,
          externalBridgeClientIp: activeClient.ip ?? endpoint.host,
          externalBridgeClientPort: activeClient.port ?? endpoint.port,
          message: `Visual Modbus controller reconnected manually from ${activeClient.ip ?? endpoint.host}. RX resumed.`,
        };
      });
      return;
    }
    setPlcDashboard((current) => ({
      ...current,
      externalBridgeEnabled: current.externalBridgeEnabled,
      externalBridgeDisconnectedByUser: current.externalBridgeDisconnectedByUser,
      externalBridgeServerOnline: true,
      externalBridgeClientConnected: current.externalBridgeDisconnectedByUser ? false : current.externalBridgeEnabled ? Boolean(activeClient || activeReader) : Boolean(activeClient),
      externalBridgeClientId: activeClient?.id,
      externalBridgeClientIp: current.externalBridgeDisconnectedByUser
        ? undefined
        : current.externalBridgeEnabled
          ? activeClient?.ip ?? activeReader?.ip ?? payload.client?.ip ?? endpoint.host
          : activeClient?.ip ?? payload.client?.ip ?? endpoint.host,
      externalBridgeClientPort: current.externalBridgeDisconnectedByUser
        ? undefined
        : current.externalBridgeEnabled
          ? activeClient?.port ?? activeReader?.port ?? payload.client?.port ?? endpoint.port
          : activeClient?.port ?? payload.client?.port ?? endpoint.port,
      message:
        !current.externalBridgeDisconnectedByUser && !current.externalBridgeEnabled && activeClient
          ? `Visual Modbus controller detected on ${bridgeUrl}. Press Visual Controller to start RX.`
          : current.message,
    }));
  }, []);

  const pollTerminalBridgeHealth = useCallback(async () => {
    const bridgeUrl = plcDashboardRef.current.externalBridgeUrl;
    try {
      const response = await fetch(`${bridgeUrl}/health`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as TerminalModbusPayload;
      applyTerminalBridgeHealth(payload, bridgeUrl);
    } catch {
      setPlcDashboard((current) => ({
        ...current,
        externalBridgeServerOnline: false,
        externalBridgeClientConnected: false,
        externalBridgeClientId: undefined,
        externalBridgeClientIp: undefined,
        externalBridgeClientPort: undefined,
      }));
    }
  }, [applyTerminalBridgeHealth]);

  const pollTerminalModbusBridge = useCallback(async () => {
    const bridgeUrl = plcDashboardRef.current.externalBridgeUrl;
    try {
      const response = await fetch(`${bridgeUrl}/state`, {
        cache: 'no-store',
        headers: {
          'X-Asset-Forge-Client': 'platform-3d',
          'X-Asset-Forge-Session': 'platform-3d-main',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as TerminalModbusPayload;
      const current = plcDashboardRef.current;
      if (payload.iotTelemetry && current.openPlc.enabled) {
        const telemetry = {
          valid: Boolean(payload.iotTelemetry.valid) && Number(payload.iotTelemetry.ageMs ?? 65535) < 3000,
          temperatureC: Number(payload.iotTelemetry.temperatureC ?? 0),
          humidityPercent: Number(payload.iotTelemetry.humidityPercent ?? 0),
          gyroDps: Number(payload.iotTelemetry.gyroDps ?? 0),
          accelX: Number(payload.iotTelemetry.accelX ?? 0),
          accelY: Number(payload.iotTelemetry.accelY ?? 0),
          accelZ: Number(payload.iotTelemetry.accelZ ?? 0),
          gyroX: Number(payload.iotTelemetry.gyroX ?? 0),
          gyroY: Number(payload.iotTelemetry.gyroY ?? 0),
          gyroZ: Number(payload.iotTelemetry.gyroZ ?? 0),
          magX: Number(payload.iotTelemetry.magX ?? 0),
          magY: Number(payload.iotTelemetry.magY ?? 0),
          magZ: Number(payload.iotTelemetry.magZ ?? 0),
          hasAcceleration: Boolean(payload.iotTelemetry.hasAcceleration),
          hasGyroscope: Boolean(payload.iotTelemetry.hasGyroscope),
          hasMagnetometer: Boolean(payload.iotTelemetry.hasMagnetometer),
          hasEnvironment: Boolean(payload.iotTelemetry.hasEnvironment),
          ageMs: Math.min(65535, Math.max(0, Math.round(Number(payload.iotTelemetry.ageMs ?? 65535)))),
          source: String(payload.iotTelemetry.source ?? 'TI SensorTag'),
          sequence: Number(payload.iotTelemetry.sequence ?? 0),
          sampleId: String(payload.iotTelemetry.sampleId ?? ''),
          quality: String(payload.iotTelemetry.quality ?? (payload.iotTelemetry.valid ? 'GOOD' : 'INVALID')),
          sourceTimestampUtc: payload.iotTelemetry.sourceTimestampUtc,
          receivedAtUtc: payload.iotTelemetry.receivedAtUtc,
          forwardedAt: new Date().toISOString(),
        };
        const signedWord = (value: number) => Math.round(Math.max(-32768, Math.min(32767, value))) & 0xffff;
        const qualityBits = (telemetry.valid ? 1 : 0) | (telemetry.ageMs < 1000 ? 2 : 0) | (telemetry.source ? 4 : 0) | (telemetry.hasAcceleration ? 8 : 0) | (telemetry.hasGyroscope ? 16 : 0) | (telemetry.hasEnvironment ? 32 : 0) | (telemetry.hasMagnetometer ? 64 : 0);
        const iotValues = new Map<string, number>([
          ['iot-temperature', signedWord((telemetry.hasEnvironment ? telemetry.temperatureC : 0) * 100)],
          ['iot-humidity', Math.round(Math.max(0, Math.min(65535, (telemetry.hasEnvironment ? telemetry.humidityPercent : 0) * 100)))],
          ['iot-gyro', Math.round(Math.max(0, Math.min(65535, (telemetry.hasGyroscope ? telemetry.gyroDps : 0) * 100)))],
          ['iot-age', telemetry.ageMs], ['iot-valid', telemetry.valid ? 1 : 0],
          ['iot-sequence', Number(telemetry.sequence ?? 0) & 0xffff], ['iot-quality', qualityBits],
        ]);
        const iotEntries = current.openPlc.endpointProfile === 's7-1200-robot-holding'
          ? [...iotValues.keys()].map((id) => ({ id, wire: physicalPlcWire[id] })).sort((a, b) => a.wire - b.wire)
          : registerConfiguration.filter((entry) => entry.enabled && iotValues.has(entry.id)).sort((a, b) => a.wire - b.wire);
        const writeBlocks = iotEntries.reduce<Array<{ address: number; values: number[] }>>((blocks, entry) => {
          const last = blocks[blocks.length - 1];
          const value = iotValues.get(entry.id) ?? 0;
          if (last && last.address + last.values.length === entry.wire) last.values.push(value);
          else blocks.push({ address: entry.wire, values: [value] });
          return blocks;
        }, []);
        if (!iotPlcForwardInFlightRef.current) {
          iotPlcForwardInFlightRef.current = true;
          try {
            const forwardTelemetry = async () => {
              for (const block of writeBlocks) {
                const response = await fetch('/__openplc/write', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ host: current.openPlc.host, port: current.openPlc.port, unitId: current.openPlc.unitId, address: block.address, values: block.values }),
                });
                if (!response.ok) {
                  const result = await response.json() as { error?: string };
                  throw new Error(result.error ?? `IoT Modbus write failed with HTTP ${response.status}`);
                }
              }
            };
            if (current.openPlc.endpointProfile === 's7-1200-robot-holding') await enqueuePhysicalPlcIo(forwardTelemetry);
            else await forwardTelemetry();
          } catch (error) {
            const detail = error instanceof Error ? error.message : 'IoT Modbus write failed';
            setPlcDashboard((state) => ({
              ...state,
              openPlc: {
                ...state.openPlc,
                runtimeIssue: `IoT remains connected, but physical PLC telemetry forwarding failed: ${detail}`,
                diagnostics: `Physical PLC telemetry forwarding failed: ${detail}`,
              },
            }));
          } finally {
            iotPlcForwardInFlightRef.current = false;
          }
        }
        setPlcDashboard((state) => ({ ...state, iotTelemetry: telemetry, externalBridgeServerOnline: true, externalBridgeLastReceivedAt: payload.timestampUtc ?? new Date().toISOString() }));
        return;
      }
      applyTerminalModbusPayload(payload, bridgeUrl);
    } catch (error) {
      setPlcDashboard((current) => ({
        ...current,
        externalBridgeOnline: false,
        externalBridgeServerOnline: false,
        externalBridgeClientConnected: false,
        externalBridgeClientId: undefined,
        externalBridgeClientIp: undefined,
        externalBridgeClientPort: undefined,
        externalBridgeLastReceivedAt: undefined,
        message: `Visual Modbus controller offline. Run: npm.cmd run modbus:controller`,
      }));
    }
  }, [applyTerminalModbusPayload, enqueuePhysicalPlcIo, registerConfiguration]);

  const toggleTerminalModbusBridge = () => {
    setPlcDashboard((current) => {
      const enabled = !current.externalBridgeEnabled;
      if (enabled) {
        plcBridgeDisconnectLockRef.current = false;
        plcBridgeReconnectArmedRef.current = false;
      }
      return {
        ...current,
        open: true,
        running: enabled ? false : current.running,
        localManualActive: enabled ? false : current.localManualActive,
        externalBridgeEnabled: enabled,
        externalBridgeDisconnectedByUser: false,
        externalBridgeOnline: enabled ? current.externalBridgeOnline : false,
        externalBridgeClientConnected: enabled ? current.externalBridgeClientConnected : false,
        externalBridgeClientId: enabled ? current.externalBridgeClientId : undefined,
        externalBridgeClientIp: enabled ? current.externalBridgeClientIp : undefined,
        externalBridgeClientPort: enabled ? current.externalBridgeClientPort : undefined,
        externalBridgeLastReceivedAt: enabled ? current.externalBridgeLastReceivedAt : undefined,
        message: enabled ? `Connecting to visual Modbus controller on ${current.externalBridgeUrl}...` : 'Visual Modbus controller disconnected.',
      };
    });
  };

  const disconnectTerminalModbusClient = async () => {
    plcBridgeDisconnectLockRef.current = true;
    plcBridgeReconnectArmedRef.current = false;
    const current = plcDashboardRef.current;
    if (current.externalBridgeClientId) {
      try {
        const response = await fetch(`${current.externalBridgeUrl}/client-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: current.externalBridgeClientId, status: 'disconnected', endpoint: current.externalBridgeUrl }),
        });
        if (response.ok) plcBridgeReconnectArmedRef.current = true;
      } catch {
        // Keep the local disconnect lock until health confirms that the client disappeared.
      }
    } else {
      plcBridgeReconnectArmedRef.current = true;
    }
    setPlcDashboard((state) => ({
      ...state,
      externalBridgeEnabled: false,
      externalBridgeOnline: false,
      externalBridgeClientConnected: false,
      externalBridgeDisconnectedByUser: true,
      externalBridgeClientId: undefined,
      externalBridgeClientIp: undefined,
      externalBridgeClientPort: undefined,
      externalBridgeLastReceivedAt: undefined,
      message: 'Visual Modbus controller client disconnected.',
    }));
    setStatus('Visual controller disconnected');
  };

  const updateModbusBridgeEndpoint = (field: 'host' | 'port', value: string) => {
    plcBridgeDisconnectLockRef.current = false;
    plcBridgeReconnectArmedRef.current = false;
    setPlcDashboard((current) => {
      const endpoint = parseModbusBridgeEndpoint(current.externalBridgeUrl);
      const nextUrl = normalizeModbusBridgeUrl(field === 'host' ? value : endpoint.host, field === 'port' ? value : endpoint.port);
      try {
        window.localStorage.setItem('assetForge.modbusBridgeUrl', nextUrl);
      } catch {
        // Local storage can be unavailable in private/browser-restricted contexts.
      }
      return {
        ...current,
        externalBridgeUrl: nextUrl,
        externalBridgeOnline: false,
        externalBridgeServerOnline: false,
        externalBridgeClientConnected: false,
        externalBridgeDisconnectedByUser: false,
        externalBridgeClientId: undefined,
        externalBridgeClientIp: undefined,
        externalBridgeClientPort: undefined,
        externalBridgeLastReceivedAt: undefined,
        message: `Visual Modbus controller endpoint set to ${nextUrl}`,
      };
    });
  };

  useEffect(() => {
    if (!plcDashboard.open && !traceAuditDrawerOpen) return undefined;
    void pollTerminalBridgeHealth();
    const timer = window.setInterval(() => {
      void pollTerminalBridgeHealth();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [plcDashboard.open, traceAuditDrawerOpen, pollTerminalBridgeHealth]);

  useEffect(() => {
    if ((!plcDashboard.open && !traceAuditDrawerOpen) || (!plcDashboard.externalBridgeEnabled && !plcDashboard.openPlc.enabled)) return undefined;
    void pollTerminalModbusBridge();
    const timer = window.setInterval(() => {
      void pollTerminalModbusBridge();
    }, 500);
    return () => window.clearInterval(timer);
  }, [plcDashboard.open, traceAuditDrawerOpen, plcDashboard.externalBridgeEnabled, plcDashboard.openPlc.enabled, pollTerminalModbusBridge]);

  const writePlcRegisterValue = (signalId: string, value: number) => {
    if (!selectedKinematicNode || !Number.isFinite(value)) return;
    const current = plcDashboardRef.current;
    const overrides = { ...current.registerOverrides, [signalId]: value };
    const register = current.frame?.physicalRegisters.find((item) => item.signalId === signalId);
    if (current.openPlc.enabled && register) {
      const definition = registerConfiguration.find((entry) => entry.enabled && entry.robotNodeId === selectedKinematicNode.id && entry.jointId === register.jointId);
      const encoding = definition?.encoding ?? current.openPlc.dataFormat;
      void fetch('/__openplc/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: current.openPlc.host,
          port: current.openPlc.port,
          unitId: current.openPlc.unitId,
          address: definition?.wire ?? register.address,
          values: encoding === 'float32-be'
            ? encodeOpenPlcFloat32(value)
            : [encodeOpenPlcInt16(encoding === 'int16-rad-x10000' ? value * 10000 : value)],
        }),
      }).catch(() => undefined);
    }
    if (current.externalBridgeEnabled) {
      void fetch(`${current.externalBridgeUrl}/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signalId,
          jointId: register?.jointId,
          displayAddress: register?.displayAddress,
          value,
        }),
      }).catch(() => undefined);
    }
    try {
      const project = current.frameNodeId === selectedKinematicNode.id && current.project
        ? current.project
        : createConfiguredPlcProject(selectedKinematicNode);
      const frame = runPlcDashboardFrame(selectedKinematicNode, 0, current.sequence + 1, project, overrides);
      setPlcDashboard((state) => ({
        ...state,
        open: true,
        running: false,
        externalBridgeLastReceivedAt: new Date().toISOString(),
        registerOverrides: overrides,
        project: frame.project,
        frame,
        frameNodeId: selectedKinematicNode.id,
        sequence: current.sequence + 1,
        message: `Manual Modbus register write reflected in digital twin: ${signalId}`,
      }));
      setStatus('Manual Modbus value applied');
    } catch (error) {
      setPlcDashboard((state) => ({ ...state, running: false, message: error instanceof Error ? error.message : 'Manual Modbus write failed' }));
      setStatus(error instanceof Error ? error.message : 'Manual Modbus write failed');
    }
  };

  const toggleRobotCursorGuideForNode = (nodeId: string) => {
    setRobotCursorGuideNodeId((current) => {
      const next = current === nodeId ? undefined : nodeId;
      if (next) {
        setTool('select');
        setDemoMotionNodeId((demoNodeId) => (demoNodeId === nodeId ? undefined : demoNodeId));
        setKinematicEditTarget(undefined);
        setStatus('Cursor robot guidance active');
        showViewportNotice('Modo guia cursor activo: agarra el brazo en el escenario y arrastra para mover toda la cadena.', 5200);
      } else {
        setStatus('Cursor robot guidance stopped');
        showViewportNotice('Modo guia cursor desactivado.', 2600);
      }
      return next;
    });
  };

  const handleRobotCursorGuide = useCallback((event: RobotCursorGuideEvent) => {
    let nextStatus = event.dragging ? 'Guiding robot arm with cursor' : 'Cursor robot guidance ready';
    setDemoMotionNodeId((current) => (current === event.nodeId ? undefined : current));
    setDocument((current) => {
      let solved = false;
      const nodes = current.nodes.map((node) => {
        if (node.id !== event.nodeId || !kinematicGeometryWithGraph(node.geometry)) return node;
        const graph = graphFromGeometry(node.geometry);
        if (!graph) return node;
        const baseState = node.geometry.kinematicState ?? createHomeKinematicState(graph);
        const result = solveRobotArmCursorTarget(graph, baseState, event.point, { preserveToolPitch: true });
        if (!result.compatible) {
          nextStatus = 'This model needs J1-J4 robot joints for cursor guidance';
          return node;
        }
        solved = true;
        nextStatus = result.reachable ? 'Guiding robot arm with cursor' : 'Cursor target clamped to reachable envelope';
        return {
          ...node,
          geometry: {
            ...node.geometry,
            kinematicGraph: graph,
            kinematicState: {
              homeJointValues: { ...baseState.homeJointValues },
              jointValues: result.jointValues,
            },
          },
        };
      });
      return solved ? touch({ ...current, selectedNodeId: event.nodeId, nodes }) : current;
    });
    setStatus(nextStatus);
  }, []);

  const resetKinematicPoseForNode = (nodeId: string) => {
    setDemoMotionNodeId((current) => (current === nodeId ? undefined : current));
    setDocument((current) =>
      touch({
        ...current,
        selectedNodeId: nodeId,
        nodes: current.nodes.map((node) => {
          if (node.id !== nodeId || !kinematicGeometryWithGraph(node.geometry)) return node;
          const graph = graphFromGeometry(node.geometry);
          if (!graph) return node;
          return {
            ...node,
            geometry: {
              ...node.geometry,
              kinematicGraph: graph,
              kinematicState: resetKinematicState(graph, node.geometry.kinematicState),
            },
          };
        }),
      }),
    );
    markWorkspaceNodesPending([nodeId]);
    setStatus('Kinematic pose reset');
  };

  const updateKinematicJointForNode = (nodeId: string, jointId: string, patch: Partial<KinematicJoint>) => {
    updateKinematicGraphForNode(nodeId, (graph) => {
      const joint = graph.joints.find((candidate) => candidate.id === jointId);
      if (!joint || !patch.origin) return updateJoint(graph, jointId, patch);
      const evidence = joint.evidence.length
        ? joint.evidence.map((item, index) => index === 0 ? { ...item, metadata: { ...item.metadata, manualOriginOverride: true } } : item)
        : [{ type: 'manual' as const, message: 'Joint pivot edited manually.', metadata: { manualOriginOverride: true } }];
      return updateJoint(graph, jointId, { ...patch, evidence });
    }, 'Kinematic joint updated', true);
    showViewportNotice('Joint definition updated. Press Test Movement to move the piece with the new definition.', 5200);
  };

  const applyPieceReferenceCenterEstimate = (event: PieceReferenceCenterEstimateEvent) => {
    const referenceCenter: PieceReferenceCenter = {
      position: event.position,
      method: event.method,
      confidence: event.confidence,
      triangleCount: event.triangleCount,
      updatedAt: new Date().toISOString(),
    };
    setDocument((current) => {
      const nextDocument = touch({
        ...current,
        nodes: current.nodes.map((node) => {
          if (node.id !== event.nodeId || !kinematicGeometryWithGraph(node.geometry) || node.geometry.pieceReferenceCenter) return node;
          const graph = graphFromGeometry(node.geometry);
          if (!graph) return node;
          const centeredGraph: KinematicGraph = {
            ...graph,
            parts: graph.parts.map((part) => ({
              ...part,
              bounds: { ...part.bounds, center: referenceCenter.position },
              metadata: { ...part.metadata, pieceReferenceCenter: referenceCenter.position },
              geometricProperties: event.geometricProperties ?? part.geometricProperties,
              massProperties: event.massProperties ?? part.massProperties,
            })),
          };
          const functionalComponent = node.geometry.functionalComponent
            ? syncComponentMotionFromGraph(
                {
                  ...node.geometry.functionalComponent,
                  bounds: { ...node.geometry.functionalComponent.bounds, center: referenceCenter.position },
                  metadata: { ...node.geometry.functionalComponent.metadata, geometricProperties: event.geometricProperties, massProperties: event.massProperties, pieceReferenceCenter: referenceCenter },
                },
                centeredGraph,
              )
            : undefined;
          return {
            ...node,
            geometry: {
              ...node.geometry,
              pieceReferenceCenter: referenceCenter,
              kinematicGraph: centeredGraph,
              kinematicState: createHomeKinematicState(centeredGraph),
              functionalComponent,
            },
          };
        }),
      });
      setIssues(validateProject(nextDocument));
      return nextDocument;
    });
    setStatus(`Piece reference estimated from ${event.triangleCount} triangles`);
    showViewportNotice(`Geometric reference calculated: ${event.method.replace('-', ' ')}. It is not used as a joint pivot.`, 6200);
  };

  const persistManualPieceReferenceCenter = (nodeId: string, position: Vector3Tuple) => {
    setDocument((current) =>
      touch({
        ...current,
        nodes: current.nodes.map((node) => {
          if (node.id !== nodeId || node.geometry.kind !== 'imported-model' || !node.geometry.isIsolatedFunctionalComponent) return node;
          const previous = node.geometry.pieceReferenceCenter;
          const referenceCenter: PieceReferenceCenter = {
            position,
            method: 'manual',
            confidence: 1,
            triangleCount: previous?.triangleCount ?? 0,
            updatedAt: new Date().toISOString(),
          };
          return {
            ...node,
            geometry: {
              ...node.geometry,
              pieceReferenceCenter: referenceCenter,
              functionalComponent: node.geometry.functionalComponent
                ? {
                    ...node.geometry.functionalComponent,
                    origin: { ...node.geometry.functionalComponent.origin, position },
                    bounds: { ...node.geometry.functionalComponent.bounds, center: position },
                    metadata: { ...node.geometry.functionalComponent.metadata, pieceReferenceCenter: referenceCenter },
                  }
                : undefined,
            },
          };
        }),
      }),
    );
    markWorkspaceNodesPending([nodeId]);
  };

  const startKinematicEditForNode = (nodeId: string, jointId: string, mode: KinematicEditTarget['mode']) => {
    const node = document.nodes.find((item) => item.id === nodeId);
    const graph = node ? graphFromGeometry(node.geometry) : undefined;
    if (!node || !graph) return;
    const joint = graph.joints.find((item) => item.id === jointId);
    if (!joint) return;
    setTool('select');
    kinematicEditSnapshotRef.current = { nodeId, jointId, joint: JSON.parse(JSON.stringify(joint)) as KinematicJoint };
    setKinematicEditTarget({
      nodeId,
      jointId,
      mode,
      origin: joint.origin.position,
      axis: joint.axis,
      drivenPoint: joint.drivenPoint,
      axisPointA: mode === 'pick-axis-b' ? kinematicEditTarget?.axisPointA : undefined,
      focusKey: `${mode}-${jointId}-${Date.now()}`,
    });
    setStatus(
      mode === 'show-joint'
        ? 'Showing joint in viewport'
        : mode === 'pick-origin'
          ? 'Pick joint origin in viewport'
          : mode === 'pick-driven-point'
            ? 'Pick moving point in viewport'
          : mode === 'axis-gizmo'
            ? 'Drag axis gizmo in viewport'
            : mode === 'ring-translate'
              ? 'Move joint ring in 3D'
              : mode === 'ring-rotate'
                ? 'Rotate joint ring in 3D'
            : 'Pick axis point in viewport',
    );
    showViewportNotice(
      mode === 'show-joint'
        ? 'Pivot red. X red, Y green, Z blue. Yellow is the movement axis.'
        : mode === 'pick-origin'
          ? 'Pick the fixed pivot point on the model surface.'
          : mode === 'pick-driven-point'
            ? 'Pick the moving end of the piece.'
            : mode === 'axis-gizmo'
              ? 'Drag the yellow handle. X red, Y green and Z blue are the reference axes.'
              : mode === 'ring-translate'
                ? 'Drag the XYZ gizmo to place the ring at the physical joint center.'
                : mode === 'ring-rotate'
                  ? 'Drag the rotation arcs to orient the ring freely in 3D.'
              : mode === 'pick-axis-a'
                ? 'Pick point A on the model. Then pick point B to define the movement axis.'
                : 'Pick point B. Axis will be normalized from A to B.',
      mode === 'show-joint' ? 5200 : 0,
    );
  };

  const handleKinematicPointPick = (event: KinematicPointPickEvent) => {
    if (event.mode === 'pick-origin') {
      const node = document.nodes.find((item) => item.id === event.nodeId);
      const graph = node ? graphFromGeometry(node.geometry) : undefined;
      const joint = graph?.joints.find((item) => item.id === event.jointId);
      const candidate = event.candidate;
      if (pieceAnalysis?.nodeId === event.nodeId) {
        const position = candidate?.frame.origin ?? event.point;
        persistManualPieceReferenceCenter(event.nodeId, position);
        updateKinematicGraphForNode(
          event.nodeId,
          (currentGraph) =>
            updateJoint(currentGraph, event.jointId, {
              origin: {
                position,
                rotation: candidate?.frame.orientation ?? currentGraph.joints.find((item) => item.id === event.jointId)?.origin.rotation ?? [0, 0, 0, 1],
              },
              axis: candidate?.frame.axis ?? currentGraph.joints.find((item) => item.id === event.jointId)?.axis ?? [0, 1, 0],
              jointFrame: candidate?.frame,
              inferredCandidate: candidate,
              source: 'manual',
              evidence: [
                ...(currentGraph.joints.find((item) => item.id === event.jointId)?.evidence ?? []),
                { type: 'manual', score: 1, message: candidate ? 'Piece reference corrected from a user-seeded mechanical frame.' : 'Piece reference corrected from the selected surface point.' },
              ],
            }),
          'Manual piece reference applied',
        );
        setKinematicEditTarget({
          nodeId: event.nodeId,
          jointId: event.jointId,
          mode: 'show-joint',
          origin: position,
          axis: candidate?.frame.axis ?? joint?.axis ?? [0, 1, 0],
          focusKey: `piece-reference-${event.jointId}-${Date.now()}`,
        });
        kinematicEditSnapshotRef.current = undefined;
        return;
      }
      if (!candidate) {
        setStatus('No reliable mechanical feature detected at this click');
        showViewportNotice('No reliable cylinder or circular interface was detected. The clicked point was not used as a pivot.', 6200);
        return;
      }
      updateKinematicGraphForNode(
        event.nodeId,
        (graph) =>
          updateJoint(graph, event.jointId, {
            origin: { position: candidate.frame.origin, rotation: candidate.frame.orientation },
            axis: candidate.frame.axis,
            jointFrame: candidate.frame,
            inferredCandidate: candidate,
            type: candidate.motionType === 'unknown' ? graph.joints.find((item) => item.id === event.jointId)?.type ?? 'fixed' : candidate.motionType,
            source: 'geometry',
            evidence: [
              ...(graph.joints.find((joint) => joint.id === event.jointId)?.evidence ?? []),
              { type: 'geometry', message: `Mechanical frame fitted from geometry seeded on ${event.objectName ?? 'model surface'}; the click itself was not used as the pivot.` },
            ],
          }),
        'Mechanical joint frame fitted',
      );
      setKinematicEditTarget(undefined);
      kinematicEditSnapshotRef.current = undefined;
      return;
    }

    if (event.mode === 'pick-driven-point') {
      setKinematicEditTarget(undefined);
      kinematicEditSnapshotRef.current = undefined;
      showViewportNotice('A two-end motion is represented by two joints in M2. No hybrid prismatic rotation was created.', 6200);
      return;
    }

    if (event.mode === 'pick-axis-a') {
      setKinematicEditTarget((current) =>
        current && current.nodeId === event.nodeId && current.jointId === event.jointId
          ? { ...current, mode: 'pick-axis-b', axisPointA: event.point }
          : undefined,
      );
      setStatus('Pick second axis point');
      return;
    }

    const pointA = kinematicEditTarget?.axisPointA;
    if (!pointA) {
      setStatus('Pick first axis point before B');
      return;
    }
    const axis = normalizeAxis([event.point[0] - pointA[0], event.point[1] - pointA[1], event.point[2] - pointA[2]]);
    if (!axis) {
      setStatus('Axis points are too close');
      return;
    }
    updateKinematicGraphForNode(
      event.nodeId,
      (graph) =>
        updateJoint(graph, event.jointId, {
          axis,
          evidence: [
            ...(graph.joints.find((joint) => joint.id === event.jointId)?.evidence ?? []),
            { type: 'manual', score: 1, message: 'Axis calculated from two picked points.', metadata: { useJointAxisVector: true } },
          ],
        }),
      'Two-point axis applied',
    );
    setKinematicEditTarget(undefined);
    kinematicEditSnapshotRef.current = undefined;
  };

  const handleKinematicAxisChange = (event: KinematicAxisChangeEvent) => {
    updateKinematicGraphForNode(
      event.nodeId,
      (graph) => {
        const joint = graph.joints.find((item) => item.id === event.jointId);
        if (!joint) return graph;
        const dominantAxisIndex = event.axis.map((value) => Math.abs(value)).indexOf(Math.max(...event.axis.map((value) => Math.abs(value))));
        const rigAxis = dominantAxisIndex === 1 ? 'Y' : dominantAxisIndex === 2 ? 'Z' : 'X';
        return updateJoint(graph, event.jointId, {
          axis: event.axis,
          origin: event.origin || event.orientation
            ? { position: event.origin ?? joint.origin.position, rotation: event.orientation ?? joint.origin.rotation }
            : joint.origin,
          jointFrame: event.origin || event.orientation
            ? {
                origin: event.origin ?? joint.origin.position,
                axis: event.axis,
                orientation: event.orientation ?? joint.jointFrame?.orientation ?? joint.origin.rotation,
                source: 'manual',
                status: 'manual',
                axisSignConvention: 'user-defined',
                evidence: joint.jointFrame?.evidence ?? { evidenceLevel: 'high', messages: ['Ring frame positioned manually in the 3D viewport.'] },
              }
            : joint.jointFrame,
          evidence: [
            { type: 'manual', score: 1, message: 'Joint frame adjusted with the viewport ring.', metadata: { rigAxis, useJointAxisVector: true, manualOriginOverride: Boolean(event.origin), ringFrame3d: Boolean(event.orientation) } },
            ...joint.evidence.filter((item) => item.metadata?.useJointAxisVector !== true),
          ],
        });
      },
      event.origin || event.orientation ? '3D ring frame adjusted' : 'Axis gizmo adjusted',
    );
  };

  const cancelActiveKinematicEdit = () => {
    const snapshot = kinematicEditSnapshotRef.current;
    if (snapshot) {
      updateKinematicGraphForNode(snapshot.nodeId, (graph) => updateJoint(graph, snapshot.jointId, snapshot.joint), 'Kinematic edit cancelled');
    }
    kinematicEditSnapshotRef.current = undefined;
    setKinematicEditTarget(undefined);
    setViewportInspection((current) => ({ ...current, phase: current.phase === 'repairing' ? 'awaiting-confirmation' : current.phase, repairMode: undefined, message: 'Edit cancelled. Test the joint again when ready.' }));
  };

  const jointRange = (joint: KinematicJoint, fullRange = false) => {
    if (joint.type === 'fixed') return { min: 0, max: 0 };
    if (joint.type === 'prismatic') {
      const lower = joint.limits?.lower ?? -1;
      const upper = joint.limits?.upper ?? 1;
      const amplitude = fullRange ? Math.min(Math.max(Math.abs(lower), Math.abs(upper)), 2) : Math.min((upper - lower) * 0.25, 0.35);
      return { min: Math.max(lower, -Math.abs(amplitude)), max: Math.min(upper, Math.abs(amplitude)) };
    }
    const lower = joint.limits?.lower ?? (joint.type === 'continuous' ? -Math.PI * 2 : -Math.PI);
    const upper = joint.limits?.upper ?? (joint.type === 'continuous' ? Math.PI * 2 : Math.PI);
    const amplitude = fullRange ? Math.min(Math.max(Math.abs(lower), Math.abs(upper)), Math.PI * 0.9) : Math.min((upper - lower) * 0.25, Math.PI / 4);
    return { min: Math.max(lower, -Math.abs(amplitude)), max: Math.min(upper, Math.abs(amplitude)) };
  };

  const openJointRangeEditor = (nodeId: string, joint: KinematicJoint) => {
    const rotational = joint.type !== 'prismatic';
    const defaultLower = rotational ? (joint.type === 'continuous' ? -Math.PI * 2 : -Math.PI) : -1;
    const defaultUpper = rotational ? (joint.type === 'continuous' ? Math.PI * 2 : Math.PI) : 1;
    const toDisplay = (value: number) => rotational ? THREE.MathUtils.radToDeg(value) : value;
    setJointRangeEditor({
      nodeId,
      jointId: joint.id,
      lower: String(Number(toDisplay(joint.limits?.lower ?? defaultLower).toFixed(4))),
      upper: String(Number(toDisplay(joint.limits?.upper ?? defaultUpper).toFixed(4))),
    });
  };

  const saveJointRange = () => {
    if (!jointRangeEditor) return;
    const node = document.nodes.find((item) => item.id === jointRangeEditor.nodeId);
    const graph = node ? graphFromGeometry(node.geometry) : undefined;
    const joint = graph?.joints.find((item) => item.id === jointRangeEditor.jointId);
    if (!joint || joint.type === 'fixed') {
      setJointRangeEditor((current) => current ? { ...current, error: 'This joint has no configurable movement.' } : current);
      return;
    }

    const lowerDisplay = Number(jointRangeEditor.lower);
    const upperDisplay = Number(jointRangeEditor.upper);
    if (!jointRangeEditor.lower.trim() || !jointRangeEditor.upper.trim() || !Number.isFinite(lowerDisplay) || !Number.isFinite(upperDisplay)) {
      setJointRangeEditor((current) => current ? { ...current, error: 'Enter two finite numeric values.' } : current);
      return;
    }
    if (lowerDisplay >= upperDisplay) {
      setJointRangeEditor((current) => current ? { ...current, error: 'Minimum must be lower than maximum.' } : current);
      return;
    }

    const rotational = joint.type !== 'prismatic';
    const lower = rotational ? THREE.MathUtils.degToRad(lowerDisplay) : lowerDisplay;
    const upper = rotational ? THREE.MathUtils.degToRad(upperDisplay) : upperDisplay;
    const unit = rotational ? 'deg' : 'model units';
    updateKinematicGraphForNode(
      jointRangeEditor.nodeId,
      (currentGraph) => updateJoint(currentGraph, joint.id, {
        limits: { ...joint.limits, lower, upper },
        status: 'candidate',
        validation: undefined,
        evidence: [
          ...joint.evidence,
          { type: 'manual', score: 1, message: `Movement range set manually: ${lowerDisplay} to ${upperDisplay} ${unit}.` },
        ],
      }),
      'Joint movement range saved',
      true,
    );
    setJointRangeEditor(undefined);
    showViewportNotice('Movement range saved with the model. Test the joint and validate it again.', 5200);
  };

  const startViewportJointTest = (nodeId: string, jointId: string, mode: ViewportJointTestMode = 'movement') => {
    const node = document.nodes.find((item) => item.id === nodeId);
    const graph = node ? graphFromGeometry(node.geometry) : undefined;
    if (!node || !graph) return;
    const joint = graph.joints.find((item) => item.id === jointId);
    if (!joint || joint.type === 'fixed') {
      setViewportInspection((current) => ({ ...current, phase: 'awaiting-confirmation', nodeId, jointId, message: 'Fixed joint. No relative movement to test.' }));
      startKinematicEditForNode(nodeId, jointId, 'show-joint');
      setWorkspaceMenu(undefined);
      return;
    }
    const range = jointRange(joint, mode === 'full-range');
    window.clearTimeout(viewportTestTimerRef.current);
    resetKinematicPoseForNode(nodeId);
    startKinematicEditForNode(nodeId, jointId, 'show-joint');
    showViewportNotice('Focusing joint. Movement test starts after the view is readable.', 3200);
    setViewportInspection((current) => ({
      ...current,
      phase: 'testing',
      nodeId,
      jointId,
      mode,
      sequence: [range.max, 0, range.min, 0],
      sequenceIndex: -1,
      repairMode: undefined,
      message: `Testing ${joint.name}. Watch the movement and confirm whether it is mechanically correct.`,
    }));
    setWorkspaceMenu(undefined);
  };

  const stopViewportJointTest = () => {
    window.clearTimeout(viewportTestTimerRef.current);
    viewportTestTimerRef.current = undefined;
    if (viewportInspection.nodeId) resetKinematicPoseForNode(viewportInspection.nodeId);
    setViewportInspection((current) => ({
      ...current,
      phase: 'stopped',
      sequence: undefined,
      sequenceIndex: undefined,
      message: 'STOP pressed. Movement stopped and mechanism returned to Home.',
    }));
  };

  const confirmViewportJointCorrect = (nodeId = viewportInspection.nodeId, jointId = viewportInspection.jointId) => {
    if (!nodeId || !jointId) return;
    setWorkspaceMenu(undefined);
    acceptKinematicJointForNode(nodeId, jointId);
    resetKinematicPoseForNode(nodeId);
    setStatus('Movement confirmed');
    setViewportInspection((current) => {
      const correctJointIds = [...new Set([...current.correctJointIds, jointId])];
      const attentionJointIds = current.attentionJointIds.filter((id) => id !== jointId);
      const isInspecting = current.inspectedJointIds?.length && current.inspectIndex !== undefined;
      return {
        ...current,
        phase: isInspecting ? 'awaiting-confirmation' : 'idle',
        correctJointIds,
        attentionJointIds,
        message: isInspecting ? 'Movement confirmed. Continue to the next joint.' : 'Movement confirmed.',
      };
    });
  };

  const markViewportJointIncorrect = (nodeId = viewportInspection.nodeId, jointId = viewportInspection.jointId) => {
    if (!nodeId || !jointId) return;
    setWorkspaceMenu(undefined);
    setStatus('What is wrong?');
    setViewportInspection((current) => ({
      ...current,
      phase: 'repairing',
      nodeId,
      jointId,
      attentionJointIds: [...new Set([...current.attentionJointIds, jointId])],
      repairMode: 'root',
      message: 'What is wrong? Choose the closest problem and the platform will open the repair tool.',
    }));
  };

  const applyViewportRepair = (repairMode: ViewportRepairMode) => {
    const { nodeId, jointId } = viewportInspection;
    if (!nodeId || !jointId) return;
    const node = document.nodes.find((item) => item.id === nodeId);
    const graph = node ? graphFromGeometry(node.geometry) : undefined;
    if (!node || !graph) return;
    const joint = graph.joints.find((item) => item.id === jointId);
    if (!joint) return;
    if (repairMode === 'pivot') startKinematicEditForNode(nodeId, jointId, 'pick-origin');
    if (repairMode === 'axis') startKinematicEditForNode(nodeId, jointId, 'axis-gizmo');
    if (repairMode === 'type') setKinematicEditTarget((current) => current ?? { nodeId, jointId, mode: 'show-joint', origin: joint.origin.position, axis: joint.axis });
    if (repairMode === 'limits' || repairMode === 'parent-child' || repairMode === 'coupling') startKinematicEditForNode(nodeId, jointId, 'show-joint');
    setViewportInspection((current) => ({
      ...current,
      phase: 'repairing',
      repairMode,
      message:
        repairMode === 'pivot'
          ? 'Select the correct pivot directly on the model.'
          : repairMode === 'axis'
            ? 'Use Axis Gizmo, Two-Point Axis, X, Y or Z, then test again.'
            : 'Apply the correction, then test the joint again.',
    }));
    setWorkspaceMenu(undefined);
  };

  const startInspectAllJoints = (pendingOnly = false) => {
    const node = selectedNode?.geometry.kind === 'imported-model' ? selectedNode : document.nodes.find((item) => item.geometry.kind === 'imported-model');
    if (!node || node.geometry.kind !== 'imported-model') {
      setStatus('Import a mechanical model first');
      return;
    }
    const graph = graphFromImportedGeometry(node.geometry);
    const jointIds = graph.joints
      .filter((joint) => joint.status !== 'rejected' && joint.type !== 'fixed')
      .filter((joint) => !pendingOnly || joint.status !== 'validated')
      .map((joint) => joint.id);
    if (!jointIds.length) {
      setViewportInspection((current) => ({ ...current, phase: 'complete', nodeId: node.id, message: 'No pending inspectable joints.' }));
      return;
    }
    setViewportInspection((current) => ({
      ...current,
      phase: 'idle',
      nodeId: node.id,
      jointId: jointIds[0],
      inspectedJointIds: jointIds,
      inspectIndex: 0,
      correctJointIds: pendingOnly ? current.correctJointIds : [],
      attentionJointIds: pendingOnly ? current.attentionJointIds : [],
      skippedJointIds: [],
      message: `Inspection 1/${jointIds.length}. Start by testing this joint.`,
    }));
    startKinematicEditForNode(node.id, jointIds[0], 'show-joint');
  };

  const nextInspectionJoint = () => {
    const { inspectedJointIds, inspectIndex, nodeId } = viewportInspection;
    if (!inspectedJointIds?.length || inspectIndex === undefined || !nodeId) return;
    const nextIndex = inspectIndex + 1;
    if (nextIndex >= inspectedJointIds.length) {
      resetKinematicPoseForNode(nodeId);
      setViewportInspection((current) => ({
        ...current,
        phase: 'complete',
        inspectIndex: nextIndex,
        message: `Mechanical Inspection Complete. Reviewed ${current.correctJointIds.length}, needs attention ${current.attentionJointIds.length}, skipped ${current.skippedJointIds.length}.`,
      }));
      return;
    }
    const nextJointId = inspectedJointIds[nextIndex];
    setViewportInspection((current) => ({
      ...current,
      phase: 'idle',
      jointId: nextJointId,
      inspectIndex: nextIndex,
      message: `Inspection ${nextIndex + 1}/${inspectedJointIds.length}. Test the highlighted joint.`,
    }));
    startKinematicEditForNode(nodeId, nextJointId, 'show-joint');
  };

  const skipInspectionJoint = () => {
    const { jointId } = viewportInspection;
    if (jointId) {
      setViewportInspection((current) => ({ ...current, skippedJointIds: [...new Set([...current.skippedJointIds, jointId])], message: 'Joint skipped for later.' }));
    }
    window.setTimeout(nextInspectionJoint, 0);
  };

  useEffect(() => {
    if (viewportInspection.phase !== 'testing' || !viewportInspection.nodeId || !viewportInspection.jointId || !viewportInspection.sequence) return undefined;
    const index = viewportInspection.sequenceIndex ?? 0;
    if (index < 0) {
      viewportTestTimerRef.current = window.setTimeout(() => {
        setViewportInspection((current) => ({ ...current, sequenceIndex: 0, message: 'Watch the movement. The yellow axis shows the joint direction.' }));
      }, 900);
      return () => window.clearTimeout(viewportTestTimerRef.current);
    }
    if (index >= viewportInspection.sequence.length) {
      resetKinematicPoseForNode(viewportInspection.nodeId);
      setViewportInspection((current) => ({
        ...current,
        phase: 'awaiting-confirmation',
        sequence: undefined,
        sequenceIndex: undefined,
        message: 'Was this movement correct?',
      }));
      return undefined;
    }
    viewportTestTimerRef.current = window.setTimeout(() => {
      setKinematicJointValueForNode(viewportInspection.nodeId!, viewportInspection.jointId!, viewportInspection.sequence![index]);
      setViewportInspection((current) => ({ ...current, sequenceIndex: index + 1 }));
    }, index === 0 ? 160 : 620);
    return () => window.clearTimeout(viewportTestTimerRef.current);
  }, [viewportInspection.phase, viewportInspection.nodeId, viewportInspection.jointId, viewportInspection.sequence, viewportInspection.sequenceIndex]);

  const acceptKinematicJointForNode = (nodeId: string, jointId: string) => {
    updateKinematicGraphForNode(nodeId, (graph) => acceptJointCandidate(graph, jointId), 'Kinematic joint accepted');
  };

  const commitKinematicJointFrameForNode = (nodeId: string, jointId: string) => {
    setDemoMotionNodeId((current) => (current === nodeId ? undefined : current));
    setDocument((current) => {
      const nextDocument = touch({
        ...current,
        selectedNodeId: nodeId,
        nodes: current.nodes.map((node) => {
          if (node.id !== nodeId || !kinematicGeometryWithGraph(node.geometry)) return node;
          const sourceGraph = graphFromGeometry(node.geometry);
          if (!sourceGraph || !sourceGraph.joints.some((joint) => joint.id === jointId)) return node;
          const sourceJoint = sourceGraph.joints.find((joint) => joint.id === jointId)!;
          const dominantAxisIndex = sourceJoint.axis.map((value) => Math.abs(value)).indexOf(Math.max(...sourceJoint.axis.map((value) => Math.abs(value))));
          const rigAxis = dominantAxisIndex === 1 ? 'Y' : dominantAxisIndex === 2 ? 'Z' : 'X';
          const manualEvidence = sourceJoint.evidence.find((item) => item.metadata?.useJointAxisVector === true);
          const graphWithOperationalAxis = manualEvidence
            ? updateJoint(sourceGraph, jointId, {
                evidence: [
                  { ...manualEvidence, metadata: { ...manualEvidence.metadata, rigAxis, useJointAxisVector: true } },
                  ...sourceJoint.evidence.filter((item) => item !== manualEvidence),
                ],
              })
            : sourceGraph;
          const graph = acceptJointCandidate(graphWithOperationalAxis, jointId);
          const homeState = createHomeKinematicState(graph);
          return {
            ...node,
            geometry: {
              ...node.geometry,
              kinematicGraph: graph,
              kinematicState: homeState,
              functionalComponent: syncComponentMotionFromGraph(node.geometry.functionalComponent, graph),
            },
          };
        }),
      });
      const saved = saveProjectToBrowser(nextDocument);
      saveProjectAutosave(saved);
      setAutosaveAvailable(true);
      setIssues(validateProject(saved));
      return saved;
    });
    kinematicEditSnapshotRef.current = undefined;
    setKinematicEditTarget(undefined);
    setTool('select');
    setViewportInspection((current) => ({
      ...current,
      phase: current.phase === 'repairing' ? 'awaiting-confirmation' : current.phase,
      repairMode: undefined,
      message: 'Joint frame adopted. The viewport returned to selection mode.',
    }));
    clearPendingWorkspaceNodes([nodeId]);
    setStatus('Joint frame adopted and saved');
    showViewportNotice('Ring orientation and reference adopted as the definitive joint movement.', 5200);
  };

  const rejectKinematicJointForNode = (nodeId: string, jointId: string) => {
    updateKinematicGraphForNode(nodeId, (graph) => rejectJointCandidate(graph, jointId), 'Kinematic joint rejected');
  };

  const deleteKinematicJointForNode = (nodeId: string, jointId: string) => {
    updateKinematicGraphForNode(nodeId, (graph) => removeJoint(graph, jointId), 'Kinematic joint deleted');
  };

  const createKinematicJointForNode = (
    nodeId: string,
    selectedObjectNames: string[],
    options: {
      origin?: [number, number, number];
      drivenPoint?: [number, number, number];
      preferredType?: KinematicJoint['type'];
      motionProfile?: KinematicJoint['motionProfile'];
      motionPlane?: KinematicJoint['motionPlane'];
    } = {},
  ) => {
    const cleanSelection = [...new Set(selectedObjectNames)].slice(0, 2);
    let createdJointId: string | undefined;
    let createdOrigin: [number, number, number] = [0, 0, 0];
    let createdAxis: [number, number, number] = [0, 0, 1];
    showViewportNotice(options.origin ? 'Creating joint at clicked point...' : 'Creating joint candidate...', 1600);
    updateKinematicGraphForNode(
      nodeId,
      (graph) => {
        const nextParts = [...graph.parts];
        const rootBounds = graph.parts.find((part) => part.id === graph.rootPartId)?.bounds;
        const ensurePart = (objectName: string): MechanicalPart => {
          const existing = nextParts.find((part) => part.meshObjectIds.includes(objectName));
          if (existing) return existing;
          const part: MechanicalPart = {
            id: `part_manual_${objectName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 48)}_${crypto.randomUUID().slice(0, 6)}`,
            name: cleanPartToken(objectName),
            meshObjectIds: [objectName],
            localFrame: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            bounds:
              rootBounds ?? {
                min: [0, 0, 0],
                max: [1, 1, 1],
                size: [1, 1, 1],
                center: [0, 0, 0],
              },
            static: false,
            visible: true,
            source: 'manual-group',
            metadata: { objectName, authoringSource: 'selected-parts' },
          };
          nextParts.push(part);
          return part;
        };
        const rootPart = graph.parts.find((part) => part.id === graph.rootPartId);
        const parent = cleanSelection.length > 1 && cleanSelection[0] ? ensurePart(cleanSelection[0]) : rootPart;
        const child = cleanSelection[1] ? ensurePart(cleanSelection[1]) : cleanSelection[0] ? ensurePart(cleanSelection[0]) : nextParts.find((part) => part.id !== parent?.id && !part.static);
        if (!parent || !child || parent.id === child.id) return { ...graph, parts: nextParts };
        const jointId = `joint_manual_${crypto.randomUUID().slice(0, 8)}`;
        const origin = options.origin ?? child.bounds.center ?? rootBounds?.center ?? [0, 0, 0];
        const joint: KinematicJoint = {
          id: jointId,
          name: `Joint ${cleanPartToken(parent.name)} to ${cleanPartToken(child.name)}`,
          parentPartId: parent.id,
          childPartId: child.id,
          type: options.preferredType ?? 'revolute',
          origin: { position: origin, rotation: [0, 0, 0, 1] },
          axis: [0, 0, 1],
          motionProfile: options.motionProfile ?? (options.preferredType === 'prismatic' ? 'linear-slide' : 'rotation-around-origin'),
          motionPlane: options.motionPlane ?? 'xy',
          drivenPoint: options.drivenPoint,
          limits: { lower: -Math.PI / 2, upper: Math.PI / 2 },
          source: 'manual',
          confidence: 1,
          evidence: [
            {
              type: 'manual',
              score: 1,
              message: options.origin
                ? 'Created in Kinematic Authoring from clicked model point. This piece can have another joint at another clicked end.'
                : 'Created in Kinematic Authoring from selected parts.',
            },
          ],
          status: 'candidate',
        };
        createdJointId = jointId;
        createdOrigin = joint.origin.position;
        createdAxis = joint.axis;
        return createJoint({ ...graph, parts: nextParts }, joint);
      },
      'Joint created. Set its movement or test the current proposal.',
      true,
    );
    if (createdJointId) {
      setKinematicEditTarget({
        nodeId,
        jointId: createdJointId,
        mode: 'show-joint',
        origin: createdOrigin,
        axis: createdAxis,
        focusKey: `created-${createdJointId}-${Date.now()}`,
      });
      setViewportInspection((current) => ({
        ...current,
        nodeId,
        jointId: createdJointId,
        phase: 'idle',
        message: 'Joint created. Test the movement or correct the pivot and axis.',
      }));
      showViewportNotice('Joint created. Pivot red, movement axis yellow. Right-click it to test.', 6200);
    } else {
      showViewportNotice('Joint was not created. Select two different parts first.', 5200);
    }
  };

  const resetImportedJointPose = () => {
    setDemoMotionNodeId(undefined);
    setMotionTrainer(undefined);
    setSelectedParts([]);
    setTool('select');
    setPartEditMode('free');
    updateSelectedNode(
      (node) => {
        if (node.geometry.kind !== 'imported-model') return node;
        return {
          ...node,
          transform: {
            ...node.transform,
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          geometry: {
            ...node.geometry,
            joints: node.geometry.joints.map((joint) => ({
              ...joint,
              rotation: [0, 0, 0],
              translation: [0, 0, 0],
            })),
            freePartTransforms: [],
            partMaterials: [],
            kinematicState: node.geometry.kinematicGraph ? resetKinematicState(node.geometry.kinematicGraph, node.geometry.kinematicState) : undefined,
          },
        };
      },
      'Factory state restored',
    );
  };

  const normalizeImportedModel = () => {
    updateSelectedNode(
      (node) => {
        if (node.geometry.kind !== 'imported-model') return node;
        const bounds = node.geometry.originalBounds;
        const maxDimension = Math.max(bounds[0], bounds[1], bounds[2], 0.0001);
        const importScale = 3 / maxDimension;
        const normalizedBounds: [number, number, number] = [bounds[0] * importScale, bounds[1] * importScale, bounds[2] * importScale];

        return {
          ...node,
          transform: {
            ...node.transform,
            position: [0, 0, 0],
            scale: [1, 1, 1],
          },
          geometry: {
            ...node.geometry,
            importScale,
            normalizedBounds,
          },
        };
      },
      'Imported model fitted to scene',
    );
  };

  const toggleImportedMotionDemo = () => {
    const graph = selectedNode ? graphFromGeometry(selectedNode.geometry) : undefined;
    if (!selectedNode || !graph || !graph.joints.length) return;
    setIndustrialCellDemoActive(false);
    setDemoMotionNodeId((current) => (current === selectedNode.id ? undefined : selectedNode.id));
    setStatus(demoMotionNodeId === selectedNode.id ? 'Motion demo stopped' : 'Motion demo started');
  };

  const toggleIndustrialCellCycle = () => {
    if (!hasIndustrialCellNodes) {
      setStatus('Load Industrial Cell first');
      return;
    }
    setDemoMotionNodeId(undefined);
    setIndustrialCellDemoActive((current) => {
      const next = !current;
      setStatus(next ? 'Industrial cell cycle started' : 'Industrial cell cycle stopped');
      showViewportNotice(next ? 'Industrial cell cycle running: gantry, conveyors, inspection machine, operator and boxes are synchronized.' : 'Industrial cell cycle stopped.', next ? 5200 : 2600);
      return next;
    });
  };

  const randomizeGenerator = () => {
    if (!selectedNode || !('generatorId' in selectedNode.geometry)) return;
    setGeometryValue('seed', Math.floor(Math.random() * 999999));
  };

  const validationCounts = {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  };
  const workspaceMenuNode = workspaceMenu ? document.nodes.find((node) => node.id === workspaceMenu.nodeId) : undefined;
  const workspaceMenuGraph = workspaceMenuNode ? graphFromGeometry(workspaceMenuNode.geometry) : undefined;
  const workspaceMenuJoint = workspaceMenuGraph?.joints.find((joint) => joint.id === workspaceMenu?.jointId);
  const workspaceMenuJointIds = workspaceMenu?.jointIds?.length ? workspaceMenu.jointIds : workspaceMenuJoint ? [workspaceMenuJoint.id] : [];
  const viewportActiveJoint = (() => {
    if (!viewportInspection.nodeId || !viewportInspection.jointId) return undefined;
    const node = document.nodes.find((item) => item.id === viewportInspection.nodeId);
    return node ? graphFromGeometry(node.geometry)?.joints.find((joint) => joint.id === viewportInspection.jointId) : undefined;
  })();
  const viewportPieceReference = (() => {
    if (!viewportInspection.nodeId) return undefined;
    const node = document.nodes.find((item) => item.id === viewportInspection.nodeId);
    return node && kinematicGeometryWithGraph(node.geometry) ? node.geometry.pieceReferenceCenter : undefined;
  })();
  const selectedInspectorGraph = selectedNode ? graphFromGeometry(selectedNode.geometry) : undefined;
  const inspectorValidatedJointCount = selectedInspectorGraph?.joints.filter((joint) => joint.status === 'validated').length ?? 0;
  const inspectorNeedsReviewCount = selectedInspectorGraph?.joints.filter((joint) => joint.status !== 'validated' && joint.status !== 'rejected').length ?? 0;
  const inspectorGuide = !selectedNode
    ? { title: 'Selecciona un objeto', message: 'Haz clic en un objeto del escenario para mostrar las acciones que se pueden aplicar.', action: undefined }
    : inspectorFocus === 'object'
      ? { title: 'Apariencia y colocacion', message: 'Si quieres mover, rotar, escalar o cambiar el color del objeto, utiliza los controles de esta etapa.', action: 'mechanics' as InspectorFocus }
      : inspectorFocus === 'mechanics'
        ? !selectedInspectorGraph
          ? { title: 'El objeto no tiene articulaciones', message: 'Importa o selecciona un modelo articulado. Si el modelo tiene piezas, abre Piezas para desmontarlo o almacenarlo.', action: 'parts' as InspectorFocus }
          : inspectorNeedsReviewCount > 0
            ? { title: `${inspectorNeedsReviewCount} joints necesitan revision`, message: 'Pulsa Show Joint, prueba el movimiento y usa Movement correct o Movement incorrect antes de guardar.', action: undefined }
            : { title: 'Mecanica preparada', message: `${inspectorValidatedJointCount} joints validados. Puedes probar el brazo completo, volver a Home y guardar la configuracion.`, action: 'twin' as InspectorFocus }
        : inspectorFocus === 'parts'
          ? { title: 'Edicion por piezas', message: selectedPartsForSelectedNode.length ? `Tienes ${selectedPartsForSelectedNode.length} piezas seleccionadas. Ahora puedes moverlas, colorearlas o almacenarlas.` : 'Activa el modo de piezas y haz clic sobre una pieza. Usa Shift para seleccionar varias.', action: undefined }
          : inspectorFocus === 'twin'
            ? { title: 'Estado operativo', message: selectedInspectorGraph ? 'Aqui se muestran senales, conexiones, historico, alarmas y escenarios. Empieza comprobando que la conexion figure ONLINE.' : 'Primero configura la mecanica del modelo para crear sus senales de gemelo digital.', action: selectedInspectorGraph ? undefined : 'mechanics' as InspectorFocus }
            : { title: 'Validar y exportar', message: 'Ejecuta el preflight. Si no hay errores, genera la vista previa y exporta el GLB.', action: undefined };
  const selectedTwinProject = useMemo(() => {
    if (!selectedNode) return undefined;
    try {
      return graphFromGeometry(selectedNode.geometry)
        ? configurePlcProject(selectedNode, createPlcTwinProjectForNode(selectedNode))
        : createTwinProjectFromAssetDocument({ ...document, nodes: [selectedNode], selectedNodeId: selectedNode.id }, { mode: 'simulation', includeSimulatedBindings: true });
    } catch {
      return undefined;
    }
  }, [selectedNode, document.metadata.id, registerConfiguration, configurePlcProject]);
  const operationalTwinProject = plcDashboard.frameNodeId === selectedNode?.id && plcDashboard.project
    ? plcDashboard.project
    : selectedTwinProject;
  const replayFrames = useMemo(
    () => operationalTwinProject && historianRecords.length ? replayRecords(operationalTwinProject, historianRecords) : [],
    [operationalTwinProject, historianRecords],
  );
  const activeReplayFrame = replayFrameIndex >= 0 ? replayFrames[replayFrameIndex] : undefined;
  const activeScenario = simulationScenarios.find((scenario) => scenario.id === activeScenarioId);
  const scenarioFrame = useMemo(() => operationalTwinProject && activeScenario
    ? runSimulationScenario(operationalTwinProject, activeScenario, scenarioElapsedMs, scenarioStartedAtRef.current ?? operationalTwinProject.metadata.updatedAtUtc)
    : undefined, [operationalTwinProject, activeScenario, scenarioElapsedMs]);
  const inspectedTwinProject = activeReplayFrame?.project ?? scenarioFrame?.project ?? operationalTwinProject;
  const viewportDocument = useMemo<AssetDocument>(() => {
    let renderedDocument = document;
    if ((activeReplayFrame || scenarioFrame) && inspectedTwinProject && selectedNode) {
    const jointValues: Record<string, number> = {};
    Object.values(inspectedTwinProject.state.reportedState).forEach((sample) => {
      const signal = inspectedTwinProject.signals.find((item) => item.id === sample.signalId);
      const jointId = typeof signal?.metadata.jointId === 'string' ? signal.metadata.jointId : undefined;
      const numeric = typeof sample.value === 'number' ? sample.value : Number(sample.value);
      if (jointId && Number.isFinite(numeric)) jointValues[jointId] = numeric;
    });
      renderedDocument = {
      ...document,
      nodes: document.nodes.map((node) => {
        if (node.id !== selectedNode.id || !('kinematicGraph' in node.geometry) || !node.geometry.kinematicGraph) return node;
        const graph = node.geometry.kinematicGraph;
        const baseState = node.geometry.kinematicState ?? createHomeKinematicState(graph);
        const boundedValues = Object.fromEntries(Object.entries(jointValues).map(([jointId, value]) => {
          const joint = graph.joints.find((item) => item.id === jointId);
          return [jointId, joint?.limits ? Math.max(joint.limits.lower ?? -Infinity, Math.min(joint.limits.upper ?? Infinity, value)) : value];
        }));
        return { ...node, geometry: { ...node.geometry, kinematicState: { homeJointValues: { ...baseState.homeJointValues }, jointValues: { ...baseState.jointValues, ...boundedValues } } } };
      }),
      };
    }
    if (!externalPlcRuntimePose) return renderedDocument;
    return {
      ...renderedDocument,
      nodes: renderedDocument.nodes.map((node) => {
        if (node.id !== externalPlcRuntimePose.nodeId || !kinematicGeometryWithGraph(node.geometry)) return node;
        const graph = graphFromGeometry(node.geometry);
        if (!graph) return node;
        const baseState = node.geometry.kinematicState ?? createHomeKinematicState(graph);
        const boundedValues = Object.fromEntries(Object.entries(externalPlcRuntimePose.jointValues).map(([jointId, value]) => {
          const joint = graph.joints.find((item) => item.id === jointId);
          return [jointId, joint?.limits ? Math.max(joint.limits.lower ?? -Infinity, Math.min(joint.limits.upper ?? Infinity, value)) : value];
        }));
        return {
          ...node,
          geometry: {
            ...node.geometry,
            kinematicState: {
              homeJointValues: { ...baseState.homeJointValues },
              jointValues: { ...baseState.jointValues, ...boundedValues },
            },
          },
        };
      }),
    };
  }, [document, selectedNode, inspectedTwinProject, activeReplayFrame, scenarioFrame, externalPlcRuntimePose]);
  const plcConditionState = plcDashboard.openPlc.rawRegisters?.[5];
  const plcAlarmCode = plcDashboard.openPlc.rawRegisters?.[4];
  const selectedVisualState = visualStateOverlayEnabled
    ? plcDashboard.openPlc.enabled && !plcDashboard.openPlc.online
      ? 'disconnected' as const
      : alarmInstances.some((alarm) => alarm.state === 'active') || (plcAlarmCode ?? 0) > 0 || (plcConditionState ?? 0) >= 2
        ? 'alarm' as const
        : plcConditionState === 1 || operationalTwinProject?.connectionHealth.some((connection) => connection.state === 'DEGRADED' || connection.quality !== 'GOOD')
          ? 'warning' as const
          : 'normal' as const
    : undefined;

  useEffect(() => {
    if (!operationalTwinProject || activeReplayFrame || !alarmRules.length) return;
    const evaluated = evaluateAlarmRules(operationalTwinProject, alarmRules, alarmInstances, new Date().toISOString());
    setAlarmInstances((current) => {
      const currentComparable = current.map(({ lastEvaluationUtc: _ignored, ...instance }) => instance);
      const nextComparable = evaluated.instances.map(({ lastEvaluationUtc: _ignored, ...instance }) => instance);
      return JSON.stringify(currentComparable) === JSON.stringify(nextComparable) ? current : evaluated.instances;
    });
    if (!evaluated.events.length) return;
    setAlarmEvents((current) => [...current, ...evaluated.events].slice(-200));
    if (historianRecording) {
      const records: HistorianRecord[] = evaluated.events.map((event, index) => ({ kind: 'event', sourceTimestampUtc: event.timestampUtc, ingestTimestampUtc: event.timestampUtc, sequence: plcDashboard.sequence + index, event }));
      setHistorianRecords((current) => [...current, ...records]);
      void historianRef.current.append(operationalTwinProject.id, records).catch((error) => setStatus(error instanceof Error ? error.message : 'Alarm historian write failed'));
    }
  }, [operationalTwinProject, alarmRules, activeReplayFrame, plcDashboard.sequence]);

  const addAlarmRule = () => {
    const signal = operationalTwinProject?.signals.find((item) => item.access === 'read');
    if (!signal) {
      setStatus('No readable TwinSignal is available for an alarm rule.');
      return;
    }
    const id = `rule-${Date.now()}`;
    setAlarmRules((current) => [...current, { id, name: `High ${signal.path}`, priority: 'medium', kind: 'high', signalId: signal.id, limit: 1, onDelayMs: 0, offDelayMs: 0, deadband: 0, enabled: true }]);
  };

  const updateAlarmRule = (ruleId: string, patch: Partial<AlarmRule>) => setAlarmRules((current) => current.map((rule) => rule.id === ruleId ? { ...rule, ...patch } as AlarmRule : rule));
  const deleteAlarmRule = (ruleId: string) => {
    if (!window.confirm('Delete this alarm rule and its current runtime instance?')) return;
    setAlarmRules((current) => current.filter((rule) => rule.id !== ruleId));
    setAlarmInstances((current) => current.filter((instance) => instance.ruleId !== ruleId));
  };

  useEffect(() => {
    if (!scenarioRunning || !activeScenario) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = now - previous;
      previous = now;
      setScenarioElapsedMs((elapsed) => {
        const next = elapsed + delta;
        if (!activeScenario.loop && next >= activeScenario.durationMs) {
          setScenarioRunning(false);
          return activeScenario.durationMs;
        }
        return activeScenario.loop ? next % activeScenario.durationMs : next;
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [scenarioRunning, activeScenario]);

  const addSimulationScenario = () => {
    const signal = operationalTwinProject?.signals.find((item) => item.access === 'read');
    if (!signal) {
      setStatus('No readable TwinSignal is available for a simulation scenario.');
      return;
    }
    const id = `scenario-${Date.now()}`;
    const scenario: SimulationScenario = {
      id,
      name: 'Signal response scenario',
      durationMs: 5000,
      loop: false,
      metadata: { createdBy: 'operator', platform: 'TwinAxis' },
      actions: [
        { atMs: 0, kind: 'reported', signalId: signal.id, value: 0, quality: 'SIMULATED' },
        { atMs: 2500, kind: 'reported', signalId: signal.id, value: 1, quality: 'SIMULATED' },
        { atMs: 5000, kind: 'reported', signalId: signal.id, value: 0, quality: 'SIMULATED' },
      ],
    };
    setSimulationScenarios((current) => [...current, scenario]);
    setActiveScenarioId(id);
    setScenarioElapsedMs(0);
  };

  const updateSimulationScenario = (scenarioId: string, patch: Partial<SimulationScenario>) => setSimulationScenarios((current) => current.map((scenario) => scenario.id === scenarioId ? { ...scenario, ...patch } : scenario));
  const runActiveScenario = () => {
    if (!activeScenario) return;
    const validation = validateSimulationScenario(activeScenario);
    if (validation.length) {
      setStatus(`Scenario invalid: ${validation.join(' ')}`);
      return;
    }
    setHistorianRecording(false);
    setReplayFrameIndex(-1);
    if (scenarioElapsedMs >= activeScenario.durationMs) setScenarioElapsedMs(0);
    scenarioStartedAtRef.current = new Date().toISOString();
    setScenarioRunning(true);
    setStatus(`Simulation scenario running: ${activeScenario.name}`);
  };

  useEffect(() => {
    if (!historianRecording || !plcDashboard.frame || !operationalTwinProject) return;
    const records: HistorianRecord[] = [
      ...plcDashboard.frame.samples.map((sample) => ({
        kind: 'sample' as const,
        sourceTimestampUtc: sample.sourceTimestampUtc ?? sample.ingestTimestampUtc,
        ingestTimestampUtc: sample.ingestTimestampUtc,
        sequence: sample.sequence,
        sample,
      })),
      ...operationalTwinProject.events.map((event, index) => ({ kind: 'event' as const, sourceTimestampUtc: event.timestampUtc, ingestTimestampUtc: event.timestampUtc, sequence: plcDashboard.sequence + index, event })),
      ...operationalTwinProject.commands.map((command, index) => ({ kind: 'command' as const, sourceTimestampUtc: command.requestedAtUtc, ingestTimestampUtc: command.requestedAtUtc, sequence: plcDashboard.sequence + index, command })),
    ].filter((record) => {
      const key = `${record.kind}|${record.sourceTimestampUtc}|${record.sequence}`;
      if (historianRecordKeysRef.current.has(key)) return false;
      historianRecordKeysRef.current.add(key);
      return true;
    });
    if (!records.length) return;
    setHistorianRecords((current) => [...current, ...records].sort((a, b) => Date.parse(a.sourceTimestampUtc) - Date.parse(b.sourceTimestampUtc) || a.sequence - b.sequence));
    void historianRef.current.append(operationalTwinProject.id, records).catch((error) => setStatus(error instanceof Error ? error.message : 'Historian write failed'));
  }, [historianRecording, plcDashboard.frame, plcDashboard.sequence, operationalTwinProject]);

  const loadRecentHistorian = async () => {
    if (!operationalTwinProject) return;
    setHistorianBusy(true);
    try {
      const end = new Date();
      const records = await historianRef.current.query(operationalTwinProject.id, new Date(end.getTime() - 3_600_000).toISOString(), end.toISOString());
      setHistorianRecords(records);
      setReplayFrameIndex(records.length ? 0 : -1);
      historianRecordKeysRef.current = new Set(records.map((record) => `${record.kind}|${record.sourceTimestampUtc}|${record.sequence}`));
      setStatus(`Historian loaded: ${records.length} records.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Historian query failed');
    } finally {
      setHistorianBusy(false);
    }
  };

  const clearHistorian = async () => {
    if (!operationalTwinProject || !window.confirm('Delete the persisted historian for this twin project?')) return;
    setHistorianBusy(true);
    try {
      await historianRef.current.clear(operationalTwinProject.id);
      historianRecordKeysRef.current.clear();
      setHistorianRecords([]);
      setReplayFrameIndex(-1);
      setStatus('Historian cleared.');
    } finally {
      setHistorianBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Hammer size={19} />
          <span>TwinAxis</span>
        </div>

        <div className="toolbar-group">
          <button title="New project" onClick={() => commit(makeStarterProject(), 'New project')}>
            <Play size={18} />
          </button>
          <button title="Open project" onClick={openNativeProject}>
            <FolderOpen size={18} />
          </button>
          <button title="Save project" onClick={save}>
            <Save size={18} />
          </button>
          <button title="Restore autosave" disabled={!autosaveAvailable} onClick={restoreAutosave}>
            <FolderOpen size={18} />
          </button>
          <input ref={fileInputRef} type="file" accept=".json,.forge.json,.twin.json" hidden onChange={openProjectFile} />
          <button title="Import Twin Package" onClick={() => twinPackageInputRef.current?.click()}><Import size={18} /></button>
          <button title="Export Twin Package" onClick={() => void exportTwinPackage()}><FileJson size={18} /></button>
          <input ref={twinPackageInputRef} type="file" accept=".twin,.twin.json,application/json" hidden onChange={importTwinPackage} />
        </div>

        <div className="toolbar-group segmented">
          <button className={activeView === 'workspace' ? 'active' : ''} title="Workspace" onClick={() => setActiveView('workspace')}>
            <Focus size={17} />
          </button>
          <button className={activeView === 'warehouse' ? 'active' : ''} title="Warehouse dashboard" onClick={() => setActiveView('warehouse')}>
            <Grid3X3 size={17} />
          </button>
        </div>

        <div className="toolbar-group">
          <button title="Undo" disabled={!past.length} onClick={undo}>
            <Undo2 size={18} />
          </button>
          <button title="Redo" disabled={!future.length} onClick={redo}>
            <Redo2 size={18} />
          </button>
        </div>

        <div className="toolbar-group segmented">
          <button className={tool === 'select' ? 'active' : ''} title="Select" onClick={() => setTool('select')}>
            <Square size={17} />
          </button>
          <button className={tool === 'translate' || (tool === 'parts' && partEditMode === 'translate') ? 'active' : ''} title="Move" onClick={() => activateTransformTool('translate')}>
            <Move3D size={18} />
          </button>
          <button className={tool === 'rotate' || (tool === 'parts' && partEditMode === 'rotate') ? 'active' : ''} title="Rotate" onClick={() => activateTransformTool('rotate')}>
            <RotateCw size={18} />
          </button>
          <button className={tool === 'scale' || (tool === 'parts' && partEditMode === 'scale') ? 'active' : ''} title="Scale" onClick={() => activateTransformTool('scale')}>
            <Scaling size={18} />
          </button>
          <button className={tool === 'parts' ? 'active' : ''} title="Parts" onClick={togglePartsTool}>
            <Cuboid size={18} />
          </button>
        </div>

        <div className="toolbar-group cycle-tools">
          <button
            className="modbus-controller-top-button"
            title="Open the integrated IoT Control Center for BLE sensors, Modbus registers and digital-twin connections."
            disabled={modbusControllerLaunching}
            onClick={() => void openModbusController()}
          >
            <Settings2 size={18} />
            <span>{modbusControllerLaunching ? 'Starting Control Center...' : 'IoT Control Center'}</span>
          </button>
          <button
            className={`plc-top-button ${plcDashboard.open ? 'active' : ''}`}
            title="Open the Digital Twin Scenario with a simulated physical robot, Modbus registers and a synchronized 3D twin."
            onClick={togglePlcDashboard}
          >
            <Activity size={18} />
            <span>Digital Twin Scenario</span>
          </button>
          <button
            className={industrialCellDemoActive ? 'active' : ''}
            title="Run the complete industrial cell cycle with one synchronized clock."
            disabled={!hasIndustrialCellNodes}
            onClick={toggleIndustrialCellCycle}
          >
            {industrialCellDemoActive ? <Pause size={18} /> : <Activity size={18} />}
            <span>Cell Cycle</span>
          </button>
          <button title="Inspect All Joints starts a viewport-guided inspection and waits for Correct, Incorrect or Skip on each joint." disabled={!selectedNode || selectedNode.geometry.kind !== 'imported-model'} onClick={() => startInspectAllJoints(false)}>
            <Play size={18} />
            <span>Inspect All</span>
          </button>
          <button title="Inspect Pending reviews only joints that are not already validated." disabled={!selectedNode || selectedNode.geometry.kind !== 'imported-model'} onClick={() => startInspectAllJoints(true)}>
            <Focus size={18} />
            <span>Inspect Pending</span>
          </button>
        </div>

        <div className="toolbar-group">
          <button title="Duplicate selected object" disabled={!selectedNode} onClick={duplicateSelected}>
            <Copy size={17} />
          </button>
          <button title={selectedNode?.visible ? 'Hide selected object' : 'Show selected object'} disabled={!selectedNode} onClick={toggleSelectedVisibility}>
            {selectedNode?.visible ? <Eye size={17} /> : <EyeOff size={17} />}
          </button>
          <button title={selectedNode?.locked ? 'Unlock selected object' : 'Lock selected object'} disabled={!selectedNode} onClick={toggleSelectedLock}>
            {selectedNode?.locked ? <Lock size={17} /> : <Unlock size={17} />}
          </button>
          <button className={snapEnabled ? 'active' : ''} title="Toggle snapping" onClick={() => setSnapEnabled((value) => !value)}>
            <Magnet size={17} />
          </button>
          <button
            title="Dismantle selected model into warehouse"
            disabled={!selectedNode || selectedNode.geometry.kind !== 'imported-model' || !selectedNode.geometry.joints.length}
            onClick={() => storePartsInWarehouse('all')}
          >
            <Cuboid size={17} />
          </button>
          <button title="Import saved warehouse object to workspace" onClick={importFirstPermanentWarehouseObject}>
            <Import size={17} />
          </button>
          <button
            className={pendingWorkspaceNodeIds.length ? 'active' : ''}
            title="Save workspace changes permanently"
            disabled={!pendingWorkspaceNodeIds.length}
            onClick={savePendingWorkspaceChanges}
          >
            <Save size={17} />
            <span>{pendingWorkspaceNodeIds.length}</span>
          </button>
          <button title="Save selected object as project warehouse GLB" disabled={!selectedNode} onClick={() => selectedNode && saveWorkspaceItemPermanent(selectedNode.id)}>
            <Save size={17} />
          </button>
          <button title="Delete selected object permanently" disabled={!selectedNode} onClick={() => selectedNode && deleteWorkspaceObjectPermanent(selectedNode.id)}>
            <Trash2 size={17} />
          </button>
          <button title="Restore imported model factory state" disabled={!selectedNode || selectedNode.geometry.kind !== 'imported-model'} onClick={resetImportedJointPose}>
            <RotateCw size={17} />
          </button>
        </div>

        <div className="toolbar-group push-right">
          <button title="Home returns the whole mechanism to its defined home configuration." disabled={!selectedNode || selectedNode.geometry.kind !== 'imported-model'} onClick={() => selectedNode && resetKinematicPoseForNode(selectedNode.id)}>
            <RotateCw size={18} />
            <span>Home</span>
          </button>
          <button title="Validate" onClick={validate}>
            <ShieldCheck size={18} />
            <span>Validate</span>
          </button>
          <button title="Export GLB" className="primary" onClick={exportGlb}>
            <Download size={18} />
            <span>Export GLB</span>
          </button>
        </div>
      </header>

      {activeView === 'workspace' ? (
      <section className="workbench" onClick={() => setWorkspaceMenu(undefined)}>
        <aside className="left-panel panel">
          <section>
            <h2>Scene</h2>
            <div className="scene-list">
              {document.nodes.map((node) => (
                <button
                  key={node.id}
                  className={node.id === document.selectedNodeId ? 'scene-item selected' : 'scene-item'}
                  onClick={() => selectNode(node.id)}
                >
                  <Cuboid size={16} />
                  <span>{node.name}</span>
                  <small>{selectedName(node.geometry)}</small>
                  <span className="scene-flags">
                    {!node.visible && <EyeOff size={13} />}
                    {node.locked && <Lock size={13} />}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2>Primitives</h2>
            <div className="library-grid">
              <button onClick={() => addNode(createBoxNode(), 'Box added')}>
                <Box size={18} />
                <span>Box</span>
              </button>
              <button onClick={() => addNode(createSphereNode(), 'Sphere added')}>
                <Circle size={18} />
                <span>Sphere</span>
              </button>
              <button onClick={() => addNode(createCylinderNode(), 'Cylinder added')}>
                <Grid3X3 size={18} />
                <span>Cylinder</span>
              </button>
              <button onClick={() => addNode(createPlaneNode(), 'Plane added')}>
                <Square size={18} />
                <span>Plane</span>
              </button>
            </div>
          </section>

          <section>
            <h2>Import</h2>
            <button className="wide-action" onClick={() => glbInputRef.current?.click()}>
              <Import size={18} />
              <span>3D Model</span>
            </button>
            <button className="wide-action" title="Load the documented industrial scene pack" onClick={addIndustrialScenePack}>
              <Activity size={18} />
              <span>Industrial Cell</span>
            </button>
            <button className="wide-action" title="Load scenario_1 with real GLB industrial objects" onClick={addScenarioOneRealCell}>
              <Cuboid size={18} />
              <span>Real Cell</span>
            </button>
            <input
              ref={glbInputRef}
              type="file"
              accept=".glb,.fbx,.dae,.obj,.3ds,.blend,.c4d,.max,.sldprt,.sldasm,model/gltf-binary"
              hidden
              onChange={importModelFile}
            />
          </section>

          <section>
            <h2>Saved Objects</h2>
            <div className="saved-object-actions">
              <button title="Load saved project warehouse objects" onClick={loadPermanentWarehouseIntoProject}>
                <FolderOpen size={16} />
                <span>Load Saved</span>
              </button>
              <button title="Import all visible warehouse objects to workspace" disabled={!(document.partWarehouse?.length)} onClick={addAllWarehouseItemsToScene}>
                <Import size={16} />
                <span>Import All</span>
              </button>
            </div>
            <div className="saved-object-list">
              {(document.partWarehouse ?? []).slice(0, 12).map((item) => (
                <button key={`workspace-${item.id}`} className="saved-object-item" title={`Import ${item.name}`} onClick={() => addWarehouseItemToScene(item)}>
                  {item.thumbnailDataUrl ? <img src={item.thumbnailDataUrl} alt="" /> : <Cuboid size={18} />}
                  <span>{item.name}</span>
                  <small>{functionalWarehouseSummary(item)}</small>
                </button>
              ))}
              {!(document.partWarehouse?.length) && <div className="empty-state compact">No saved objects loaded.</div>}
            </div>
          </section>

          <section>
            <h2>Industrial Models</h2>
            <div className="generator-list">
              {industrialSceneModelIds.map((modelId) => {
                const generator = getGeneratorDefinition(modelId);
                if (!generator) return null;
                return (
                  <button key={modelId} className="generator-item" onClick={() => addIndustrialSceneModel(modelId)}>
                    <Activity size={18} />
                    <span>{generator.name}</span>
                    <small>{generator.description}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <h2>Generators</h2>
            <div className="generator-list">
              {generatorDefinitions.filter((generator) => !generator.id.startsWith('industrial-')).map((generator) => (
                <button key={generator.id} className="generator-item" onClick={() => addNode(createGeneratorNode(generator.id), `${generator.name} generated`)}>
                  <Sparkles size={18} />
                  <span>{generator.name}</span>
                  <small>{generator.description}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <ThreeViewport
          document={viewportDocument}
          tool={tool}
          partEditMode={partEditMode}
          snapEnabled={snapEnabled}
          viewportNotice={viewportNotice}
          kinematicEditTarget={activeKinematicEditTarget}
          motionDemoNodeId={demoMotionNodeId}
          industrialCellDemoActive={industrialCellDemoActive}
          robotCursorGuideNodeId={robotCursorGuideNodeId}
          motionTrainingPreview={motionTrainingPreview}
          visualState={selectedVisualState}
          onSelect={selectNode}
          onTransformCommit={updateNodeTransform}
          onImportedPartTransformsCommit={updateImportedPartTransforms}
          onJointPoseChange={setImportedJointMotionForNode}
          onKinematicPointPick={handleKinematicPointPick}
          onKinematicAxisChange={handleKinematicAxisChange}
          onRobotCursorGuide={handleRobotCursorGuide}
          onPieceReferenceCenterEstimate={applyPieceReferenceCenterEstimate}
          onPartSelectionChange={updatePartSelectionStatus}
          onNodeContextMenu={(event) => {
            const mode = event.jointId ? 'joint' : event.objectName ? 'part' : 'object';
            setWorkspaceMenu({ ...event, mode });
            if (event.jointId) {
              startKinematicEditForNode(event.nodeId, event.jointId, 'show-joint');
              setViewportInspection((current) => ({
                ...current,
                nodeId: event.nodeId,
                jointId: event.jointId,
                phase: current.phase === 'testing' ? current.phase : 'idle',
                message: 'Select Test Movement to inspect this joint.',
              }));
            }
          }}
          onNodeDoubleClick={(event) => {
            void enterPieceAnalysis(event);
          }}
          onStatsChange={setStats}
        />

        {plcDashboard.open && activeView === 'workspace' && (
          <PlcModbusDashboard
            node={plcControlledKinematicNode ?? selectedKinematicNode}
            state={plcDashboard}
            onStart={startPlcDashboard}
            onStop={stopPlcDashboard}
            onStep={stepPlcDashboard}
            onToggleAdvanced={togglePlcDashboardAdvanced}
            onToggleTerminalBridge={toggleTerminalModbusBridge}
            onDisconnectTerminalBridge={disconnectTerminalModbusClient}
            onEndpointChange={updateModbusBridgeEndpoint}
            onWriteRegister={writePlcRegisterValue}
            onPlcInputChange={setPlcInput}
            onPlcFaultReset={resetPlcFault}
            onPlcScanTargetChange={changePlcScanTarget}
            onToggleOpenPlc={toggleOpenPlc}
            onProbeOpenPlc={probeOpenPlc}
            onTestPhysicalPlcConnection={testPhysicalPlcConnection}
            onTestPhysicalPlcReaction={testPhysicalPlcHomeReaction}
            onTestPhysicalPlcJog={testPhysicalPlcJog}
            physicalPlcDemoActive={physicalPlcDemoActive}
            onTogglePhysicalPlcDemo={togglePhysicalPlcStartDemo}
            onOpenPlcCommand={writeOpenPlcCommand}
            onActivateLocalManual={activateLocalManualControl}
            onOpenPlcSensorPolicy={writeOpenPlcSensorPolicy}
            onOpenPlcConfigChange={updateOpenPlcConfig}
            historianRecording={historianRecording}
            historianRecordCount={historianRecords.length}
            onToggleHistorianRecording={() => setHistorianRecording((recording) => !recording)}
            onClose={() => setPlcDashboard((current) => ({ ...current, open: false, running: false }))}
          />
        )}

        {(viewportInspection.phase !== 'idle' || Boolean(viewportInspection.inspectedJointIds?.length)) && viewportInspection.nodeId && viewportInspection.jointId && activeView === 'workspace' && (
          <div className={`viewport-inspection-card phase-${viewportInspection.phase}`} onClick={(event) => event.stopPropagation()}>
            <div>
              <strong>{viewportActiveJoint?.name ?? 'Joint inspection'}</strong>
              <span>
                {viewportInspection.inspectedJointIds?.length && viewportInspection.inspectIndex !== undefined
                  ? `Inspection ${Math.min(viewportInspection.inspectIndex + 1, viewportInspection.inspectedJointIds.length)}/${viewportInspection.inspectedJointIds.length}`
                  : viewportActiveJoint?.type ?? 'joint'}
              </span>
            </div>
            <p>{viewportInspection.message}</p>
            {viewportInspection.phase === 'testing' && (
              <button className="danger stop-button" title="STOP immediately stops the current automatic movement, cancels timers and returns the mechanism to Home." onClick={stopViewportJointTest}>
                STOP
              </button>
            )}
            {viewportInspection.phase === 'idle' && viewportInspection.inspectedJointIds?.length && (
              <div className="viewport-inspection-actions">
                <button title="Runs a safe movement sequence for this joint so you can visually verify whether its mechanical behavior is correct." onClick={() => startViewportJointTest(viewportInspection.nodeId!, viewportInspection.jointId!, 'movement')}>
                  <Play size={15} />
                  <span>Test Movement</span>
                </button>
                <button title="Skip this joint for later review." onClick={skipInspectionJoint}>
                  <ArrowUp size={15} />
                  <span>Skip</span>
                </button>
              </div>
            )}
            {viewportInspection.phase === 'awaiting-confirmation' && (
              <div className="viewport-inspection-actions">
                <button title="Confirms that the observed movement matches the intended mechanical behavior." onClick={() => confirmViewportJointCorrect()}>
                  <Check size={15} />
                  <span>Correct</span>
                </button>
                <button title="Starts a guided repair flow for this joint." onClick={() => markViewportJointIncorrect()}>
                  <X size={15} />
                  <span>Incorrect</span>
                </button>
                {viewportInspection.inspectedJointIds?.length && (
                  <>
                    <button title="Move to the next joint after confirming or skipping this one." onClick={nextInspectionJoint}>
                      <ArrowDown size={15} />
                      <span>Next</span>
                    </button>
                    <button title="Skip this joint for later review." onClick={skipInspectionJoint}>
                      <ArrowUp size={15} />
                      <span>Skip</span>
                    </button>
                  </>
                )}
              </div>
            )}
            {viewportInspection.phase === 'repairing' && viewportInspection.repairMode === 'root' && (
              <div className="viewport-repair-grid">
                {pieceAnalysis?.nodeId === viewportInspection.nodeId && viewportInspection.jointId && (
                  <>
                    <div className="context-note axis-guide">
                      Reference center: {viewportPieceReference ? `${viewportPieceReference.method.replace('-', ' ')} (${Math.round(viewportPieceReference.confidence * 100)}%)` : 'calculating from mesh geometry...'}. It is the red pivot and the common origin for this isolated piece.
                    </div>
                    <button title="Click the point that should be the piece reference center. This replaces the automatic estimate and is saved with the piece." onClick={() => startKinematicEditForNode(viewportInspection.nodeId!, viewportInspection.jointId!, 'pick-origin')}>
                      Correct reference center
                    </button>
                    <button title="This piece has no own movement. Its motion will come only from the assembly where it is mounted." onClick={() => setPieceStaticMode(viewportInspection.nodeId!, viewportInspection.jointId!, true)}>
                      Static piece
                    </button>
                    <button title="This piece can move. Define one-end or two-end motion next." onClick={() => setPieceStaticMode(viewportInspection.nodeId!, viewportInspection.jointId!, false)}>
                      Dynamic piece
                    </button>
                    <button title="Single movement point: the whole piece rotates or slides from one joint origin." onClick={() => setPieceEndpointMode(viewportInspection.nodeId!, viewportInspection.jointId!, 'single')}>
                      One end
                    </button>
                    <button title="Two extremes: one fixed point and one moving point. Use it for links with a fixed end and a driven end." onClick={() => setPieceEndpointMode(viewportInspection.nodeId!, viewportInspection.jointId!, 'two-end')}>
                      Two ends
                    </button>
                  </>
                )}
                {[
                  ['pivot', 'Wrong pivot'],
                  ['axis', 'Wrong axis'],
                  ['type', 'Wrong movement type'],
                  ['axis', 'Wrong direction'],
                  ['limits', 'Wrong limits'],
                  ['parent-child', 'Wrong moving part'],
                  ['parent-child', 'Wrong parent/child relationship'],
                  ['coupling', 'Coupled movement incorrect'],
                ].map(([mode, label]) => (
                  <button key={label} title={`Opens the guided repair tool for ${label}.`} onClick={() => applyViewportRepair(mode as ViewportRepairMode)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {viewportInspection.phase === 'repairing' && viewportInspection.repairMode && viewportInspection.repairMode !== 'root' && viewportInspection.nodeId && viewportInspection.jointId && (
              <div className="viewport-repair-tools">
                {viewportInspection.repairMode === 'axis' && (
                  <>
                    <div className="context-note axis-guide">X rojo, Y verde, Z azul. El eje amarillo es el eje activo del joint; cambiarlo no mueve la pieza hasta pulsar Test Movement.</div>
                    <button title="Edit the axis directly with the 3D viewport gizmo." onClick={() => startKinematicEditForNode(viewportInspection.nodeId!, viewportInspection.jointId!, 'axis-gizmo')}>Axis Gizmo</button>
                    <button title="Select point A and point B on the model to define the axis direction." onClick={() => startKinematicEditForNode(viewportInspection.nodeId!, viewportInspection.jointId!, 'pick-axis-a')}>Two-Point Axis</button>
                    {(['X', 'Y', 'Z'] as const).map((axis) => (
                      <button
                        key={axis}
                        title={`Set ${axis} as the joint movement axis. This edits the definition only; it does not move the piece until Test Movement.`}
                        onClick={() => {
                          const axisVector: [number, number, number] = axis === 'X' ? [1, 0, 0] : axis === 'Y' ? [0, 1, 0] : [0, 0, 1];
                          const node = document.nodes.find((item) => item.id === viewportInspection.nodeId);
                          updateKinematicJointForNode(
                            viewportInspection.nodeId!,
                            viewportInspection.jointId!,
                            pieceAnalysis?.nodeId === viewportInspection.nodeId
                              ? centeredAxisPatchForPiece(node, viewportActiveJoint, axisVector)
                              : axisPatchForJoint(viewportActiveJoint, axisVector),
                          );
                          startKinematicEditForNode(viewportInspection.nodeId!, viewportInspection.jointId!, 'show-joint');
                        }}
                      >
                        Set {axis}
                      </button>
                    ))}
                    {(['xy', 'xz', 'yz'] as const).map((plane) => (
                      <button key={plane} title={`Lock this joint to motion plane ${plane.toUpperCase()}.`} onClick={() => updateKinematicJointForNode(viewportInspection.nodeId!, viewportInspection.jointId!, { motionPlane: plane })}>
                        Plano {plane.toUpperCase()}
                      </button>
                    ))}
                    {[
                      ['X+', [1, 0, 0], 'yz'],
                      ['X-', [-1, 0, 0], 'yz'],
                      ['Y+', [0, 1, 0], 'xy'],
                      ['Y-', [0, -1, 0], 'xy'],
                      ['Z+', [0, 0, 1], 'xz'],
                      ['Z-', [0, 0, -1], 'xz'],
                    ].map(([label, axisValue, plane]) => (
                      <button
                        key={`slide-${label}`}
                        title={`Pure linear movement on ${label}. No rotation and no movement on other axes.`}
                        onClick={() => {
                          const node = document.nodes.find((item) => item.id === viewportInspection.nodeId);
                          const center = node && pieceAnalysis?.nodeId === viewportInspection.nodeId && kinematicGeometryWithGraph(node.geometry) ? pieceReferenceCenter(node.geometry) : undefined;
                          updateKinematicJointForNode(viewportInspection.nodeId!, viewportInspection.jointId!, {
                            type: 'prismatic',
                            motionProfile: 'linear-slide',
                            axis: axisValue as [number, number, number],
                            motionPlane: plane as MotionPlane,
                            origin: center ? { position: center, rotation: [0, 0, 0, 1] } : viewportActiveJoint?.origin,
                            limits: viewportActiveJoint?.limits ?? { lower: -0.5, upper: 0.5 },
                          });
                        }}
                      >
                        Slide {label}
                      </button>
                    ))}
                    <button title="Reverse the current axis direction." onClick={() => viewportActiveJoint && updateKinematicJointForNode(viewportInspection.nodeId!, viewportInspection.jointId!, { axis: [-viewportActiveJoint.axis[0], -viewportActiveJoint.axis[1], -viewportActiveJoint.axis[2]] })}>Reverse direction</button>
                  </>
                )}
                {viewportInspection.repairMode === 'pivot' && (
                  <>
                    <button title="Pick the physical pivot point directly on the model surface." onClick={() => startKinematicEditForNode(viewportInspection.nodeId!, viewportInspection.jointId!, 'pick-origin')}>Pick Joint Origin</button>
                    <button title="Cancel the active pivot edit and restore the previous joint value." onClick={cancelActiveKinematicEdit}>Cancel</button>
                  </>
                )}
                {viewportInspection.repairMode === 'type' && (
                  <>
                    <div className="context-note axis-guide">Rotatorio: la pieza queda en su sitio y gira sobre el pivot rojo. Punto fijo: eliges punto fijo y punto móvil. Traslación lineal: toda la pieza se mueve sin rotar.</div>
                    <button
                      title="Define pure rotation around the clicked pivot. The piece does not translate; it rotates around X, Y or Z."
                      onClick={() => {
                        updateKinematicJointForNode(viewportInspection.nodeId!, viewportInspection.jointId!, {
                          type: 'revolute',
                          motionProfile: 'rotation-around-origin',
                          motionPlane: viewportActiveJoint?.motionPlane ?? rotationPlaneForAxis(viewportActiveJoint?.axis ?? [0, 0, 1]),
                        });
                        startKinematicEditForNode(viewportInspection.nodeId!, viewportInspection.jointId!, 'show-joint');
                      }}
                    >
                      Rotatorio
                    </button>
                    <button
                      title="Move both ends of the piece together along the selected axis. No rotation and no fixed/mobile point pair."
                      onClick={() => {
                        updateKinematicJointForNode(viewportInspection.nodeId!, viewportInspection.jointId!, {
                          type: 'prismatic',
                          motionProfile: 'linear-slide',
                          motionPlane: viewportActiveJoint?.motionPlane ?? defaultPlaneForLinearAxis(viewportActiveJoint?.axis ?? [0, 1, 0]),
                        });
                        startKinematicEditForNode(viewportInspection.nodeId!, viewportInspection.jointId!, 'show-joint');
                      }}
                    >
                      Traslacion lineal
                    </button>
                    <button title="Change movement type to continuous rotation around the red pivot." onClick={() => updateKinematicJointForNode(viewportInspection.nodeId!, viewportInspection.jointId!, { type: 'continuous', motionProfile: 'rotation-around-origin' })}>Continuous rotation</button>
                    <button title="Mark this as a fixed joint with no relative movement." onClick={() => updateKinematicJointForNode(viewportInspection.nodeId!, viewportInspection.jointId!, { type: 'fixed' })}>Fixed</button>
                  </>
                )}
                {viewportInspection.repairMode === 'limits' && viewportActiveJoint && (
                  <>
                    <label><span>Minimum</span><input type="number" step={0.01} value={viewportActiveJoint.limits?.lower ?? 0} onChange={(event) => updateKinematicJointForNode(viewportInspection.nodeId!, viewportInspection.jointId!, { limits: { ...viewportActiveJoint.limits, lower: Number(event.target.value) } })} /></label>
                    <label><span>Maximum</span><input type="number" step={0.01} value={viewportActiveJoint.limits?.upper ?? 0} onChange={(event) => updateKinematicJointForNode(viewportInspection.nodeId!, viewportInspection.jointId!, { limits: { ...viewportActiveJoint.limits, upper: Number(event.target.value) } })} /></label>
                  </>
                )}
                {viewportInspection.repairMode === 'coupling' && viewportActiveJoint && (
                  <>
                    <button title="Make coupled movement follow the same direction as the driver." onClick={() => updateKinematicJointForNode(viewportInspection.nodeId!, viewportInspection.jointId!, { coupling: viewportActiveJoint.coupling ? { ...viewportActiveJoint.coupling, multiplier: 1 } : viewportActiveJoint.coupling })}>Move together</button>
                    <button title="Make coupled movement move opposite to the driver, useful for grippers." onClick={() => updateKinematicJointForNode(viewportInspection.nodeId!, viewportInspection.jointId!, { coupling: viewportActiveJoint.coupling ? { ...viewportActiveJoint.coupling, multiplier: -1 } : viewportActiveJoint.coupling })}>Move opposite</button>
                  </>
                )}
                <button className="primary" title="Runs the same safe movement sequence again after your correction." onClick={() => startViewportJointTest(viewportInspection.nodeId!, viewportInspection.jointId!, viewportInspection.mode ?? 'movement')}>Test Again</button>
                <button title="Stops editing this issue and returns to the decision step." onClick={() => setViewportInspection((current) => ({ ...current, phase: 'awaiting-confirmation', repairMode: undefined, message: 'Was this movement correct?' }))}>Cancel</button>
              </div>
            )}
            {viewportInspection.phase === 'complete' && (
              <div className="viewport-inspection-actions">
                <button title="Review joints marked as needing attention." onClick={() => setViewportInspection((current) => ({ ...current, phase: 'idle', message: 'Select a problem joint from the viewport or list.' }))}>Review problems</button>
                <button title="Validate checks graph structure and reported mechanical issues." onClick={validate}>Validate</button>
                <button title="Save stores the mechanical setup in the current project." onClick={save}>Save</button>
              </div>
            )}
          </div>
        )}

        <aside className="right-panel panel">
          <div className="inspector-head">
            <div>
              <h2>Inspector</h2>
              <p>{selectedNode ? selectedNode.name : 'No selection'}</p>
            </div>
            <button title="Delete selected object" disabled={!selectedNode} onClick={removeSelected}>
              <Trash2 size={17} />
            </button>
          </div>

          <div className="inspector-workflow" aria-label="Inspector workflow">
            <div className="inspector-priority-nav" role="tablist" aria-label="Inspector sections">
              {([
                ['object', '1', 'Objeto'],
                ['mechanics', '2', 'Mecanica'],
                ['parts', '3', 'Piezas'],
                ['twin', '4', 'Twin'],
                ['export', '5', 'Exportar'],
              ] as Array<[InspectorFocus, string, string]>).map(([focus, order, label]) => (
                <button
                  key={focus}
                  type="button"
                  role="tab"
                  aria-selected={inspectorFocus === focus}
                  className={inspectorFocus === focus ? 'active' : ''}
                  onClick={() => setInspectorFocus(focus)}
                  title={`Etapa ${order}: ${label}`}
                >
                  <b>{order}</b><span>{label}</span>
                </button>
              ))}
            </div>
            <div className="inspector-dynamic-guide" role="status" aria-live="polite">
              <HelpCircle size={16} />
              <div><strong>{inspectorGuide.title}</strong><p>{inspectorGuide.message}</p></div>
              {inspectorGuide.action && (
                <button type="button" onClick={() => setInspectorFocus(inspectorGuide.action!)}>
                  Ir a {inspectorGuide.action === 'mechanics' ? 'Mecanica' : inspectorGuide.action === 'parts' ? 'Piezas' : 'Twin'}
                  <ChevronRight size={14} />
                </button>
              )}
            </div>
          </div>

          {inspectorFocus === 'mechanics' && <button
            className="inspector-advanced-rig-launcher"
            title={selectedNode && graphFromGeometry(selectedNode.geometry) ? 'Open Advanced Rig and its guided tutorial' : 'Select an articulated model to open Advanced Rig'}
            disabled={!selectedNode || !graphFromGeometry(selectedNode.geometry)}
            onClick={() => window.dispatchEvent(new CustomEvent('asset-forge:open-advanced-rig'))}
          >
            <Settings2 size={16} />
            <span><strong>Advanced Rig</strong><small>Mechanical setup and guided help</small></span>
            <HelpCircle size={15} />
          </button>}

          {selectedNode ? (
            <>
              {inspectorFocus === 'object' && <section className="inspector-stage-section">
                <h3>Transform</h3>
                <VectorEditor label="Position" values={selectedNode.transform.position} onChange={(index, value) => setTransformValue('position', index, value)} />
                <VectorEditor label="Rotation" values={selectedNode.transform.rotation} step={0.05} onChange={(index, value) => setTransformValue('rotation', index, value)} />
                <VectorEditor label="Scale" values={selectedNode.transform.scale} step={0.05} onChange={(index, value) => setTransformValue('scale', index, value)} />
              </section>}

              {inspectorFocus === 'object' && <section className="inspector-stage-section">
                <h3>Material</h3>
                <label className="field-row">
                  <span>Preset</span>
                  <select value={selectedNode.material.name} onChange={(event) => applyMaterialPreset(event.target.value)}>
                    {!materialPresets.some((preset) => preset.name === selectedNode.material.name) && (
                      <option value={selectedNode.material.name}>{selectedNode.material.name}</option>
                    )}
                    {materialPresets.map((preset) => (
                      <option key={preset.name} value={preset.name}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="material-presets">
                  {materialPresets.map((preset) => (
                    <button
                      key={preset.name}
                      title={preset.name}
                      className={selectedNode.material.name === preset.name ? 'swatch active' : 'swatch'}
                      style={{ backgroundColor: preset.color }}
                      onClick={() => applyMaterialPreset(preset.name)}
                    >
                      <Palette size={14} />
                    </button>
                  ))}
                </div>
                <label className="field-row">
                  <span>Custom color</span>
                  <input type="color" value={selectedNode.material.color} onChange={(event) => setMaterialValue('color', event.target.value)} />
                  <span className="color-value">{selectedNode.material.color}</span>
                </label>
                <Slider label="Roughness" value={selectedNode.material.roughness} min={0} max={1} step={0.01} onChange={(value) => setMaterialValue('roughness', value)} />
                <Slider label="Metalness" value={selectedNode.material.metalness} min={0} max={1} step={0.01} onChange={(value) => setMaterialValue('metalness', value)} />
              </section>}

              {inspectorFocus === 'twin' && inspectedTwinProject && (
                <section className="twin-inspector" aria-label="Twin Inspector">
                  <div className="section-title-row"><h3>Twin Inspector</h3><span className="twin-mode-badge">{activeReplayFrame ? 'replay' : inspectedTwinProject.mode}</span></div>
                  <button
                    type="button"
                    className={visualStateOverlayEnabled ? 'wide-action active twin-overlay-toggle' : 'wide-action twin-overlay-toggle'}
                    title="Show the selected asset operational state without modifying its geometry or materials"
                    aria-pressed={visualStateOverlayEnabled}
                    onClick={() => setVisualStateOverlayEnabled((enabled) => !enabled)}
                  >
                    {visualStateOverlayEnabled ? <Eye size={15} /> : <EyeOff size={15} />}
                    <span>State overlay</span>
                    <i className={`operational-state ${selectedVisualState ?? 'off'}`}>{selectedVisualState ?? 'off'}</i>
                  </button>
                  <div className="twin-inspector-summary">
                    <span><b>{inspectedTwinProject.properties.length}</b> properties</span>
                    <span><b>{inspectedTwinProject.signalBindings.length}</b> bindings</span>
                    <span><b>{inspectedTwinProject.connectionHealth.filter((item) => item.state === 'ONLINE').length}</b> online</span>
                  </div>
                  <div className="twin-property-list">
                    {inspectedTwinProject.properties.slice(0, 12).map((property) => {
                      const binding = inspectedTwinProject.signalBindings.find((item) => item.propertyId === property.id);
                      const replaySample = Object.values(inspectedTwinProject.state.reportedState).find((sample) => sample.signalId === binding?.propertyId || sample.signalId === property.id);
                      const live = activeReplayFrame ? undefined : plcDashboard.frame?.digitalTwinState.find((item) => item.jointId === property.metadata.jointId);
                      return <div className="twin-property-row" key={property.id}>
                        <span><strong>{property.name}</strong><small>{property.path}</small></span>
                        <code>{live?.value?.toFixed(4) ?? replaySample?.value?.toString() ?? property.value ?? '--'} {property.unit ?? ''}</code>
                        <i className={(live?.quality ?? replaySample?.quality ?? property.quality).toLowerCase()}>{live?.quality ?? replaySample?.quality ?? property.quality}</i>
                        <small>{binding ? `${binding.protocol.toUpperCase()} · ${binding.status}` : 'UNBOUND'}</small>
                      </div>;
                    })}
                  </div>
                  <div className="live-twin-monitor">
                    <h4>Live Twin Monitor</h4>
                    <div><span>Connections</span><strong>{inspectedTwinProject.connectionHealth.length}</strong></div>
                    <div><span>Events</span><strong>{inspectedTwinProject.events.length}</strong></div>
                    <div><span>Commands</span><strong>{inspectedTwinProject.commands.length}</strong></div>
                    <div><span>Alarms</span><strong>{inspectedTwinProject.events.filter((event) => event.type === 'alarm').length}</strong></div>
                  </div>
                  <div className="historian-panel" aria-label="Historian and Replay">
                    <div className="section-title-row"><h4>Historian &amp; Replay</h4><span>{historianRecords.length} records</span></div>
                    <div className="historian-actions">
                      <button type="button" className={historianRecording ? 'active' : ''} disabled={Boolean(activeReplayFrame)} onClick={() => setHistorianRecording((recording) => !recording)}>{historianRecording ? <Pause size={13} /> : <Activity size={13} />}<span>{historianRecording ? 'Stop' : 'Record'}</span></button>
                      <button type="button" disabled={historianBusy} onClick={() => void loadRecentHistorian()}><FolderOpen size={13} /><span>Load 1h</span></button>
                      <button type="button" disabled={historianBusy || !historianRecords.length} onClick={() => void clearHistorian()}><Trash2 size={13} /><span>Clear</span></button>
                    </div>
                    <input aria-label="Replay timeline" type="range" min="-1" max={Math.max(-1, replayFrames.length - 1)} value={Math.min(replayFrameIndex, replayFrames.length - 1)} disabled={!replayFrames.length || historianRecording} onChange={(event) => setReplayFrameIndex(Number(event.target.value))} />
                    <div className="replay-readout">
                      <span>{activeReplayFrame ? new Date(activeReplayFrame.virtualTimeUtc).toLocaleTimeString() : 'LIVE'}</span>
                      <strong>{activeReplayFrame ? `${activeReplayFrame.record.kind} #${activeReplayFrame.sequence}` : 'read/write runtime'}</strong>
                      <code>{replayFrames.length ? deterministicReplayHash(replayFrames) : 'no replay data'}</code>
                    </div>
                    {activeReplayFrame && <button type="button" className="wide-action" onClick={() => setReplayFrameIndex(-1)}><Play size={13} /><span>Return to live</span></button>}
                  </div>
                  <div className="alarm-center" aria-label="Twin alarm center">
                    <div className="section-title-row"><h4>Alarm Center</h4><button type="button" title="Add alarm rule" onClick={addAlarmRule}><AlertTriangle size={13} /><span>Add rule</span></button></div>
                    <div className="alarm-summary">
                      <span><b>{alarmInstances.filter((alarm) => alarm.state === 'active').length}</b> active</span>
                      <span><b>{alarmInstances.filter((alarm) => alarm.state === 'acked').length}</b> acked</span>
                      <span><b>{alarmInstances.filter((alarm) => alarm.state === 'shelved').length}</b> shelved</span>
                    </div>
                    {alarmRules.map((rule) => {
                      const instance = alarmInstances.find((item) => item.ruleId === rule.id);
                      const thresholdRule = rule.kind === 'high' || rule.kind === 'low' ? rule : undefined;
                      const qualityRule = rule.kind === 'quality' ? rule : undefined;
                      return <div className="alarm-rule-row" key={rule.id}>
                        <label><span>Name</span><input value={rule.name} onChange={(event) => updateAlarmRule(rule.id, { name: event.target.value })} /></label>
                        <label><span>Type</span><select value={rule.kind} onChange={(event) => {
                          const kind = event.target.value as 'high' | 'low' | 'quality';
                          const signalId = thresholdRule?.signalId ?? qualityRule?.signalId ?? inspectedTwinProject.signals[0]?.id ?? '';
                          setAlarmRules((current) => current.map((item) => item.id !== rule.id ? item : kind === 'quality'
                            ? { id: item.id, name: item.name, priority: item.priority, kind, signalId, qualities: ['BAD', 'STALE', 'COMM_LOST'], enabled: item.enabled }
                            : { id: item.id, name: item.name, priority: item.priority, kind, signalId, limit: 1, deadband: 0, enabled: item.enabled }));
                        }}><option value="high">High</option><option value="low">Low</option><option value="quality">Quality</option></select></label>
                        <label><span>Signal</span><select value={thresholdRule?.signalId ?? qualityRule?.signalId ?? ''} onChange={(event) => updateAlarmRule(rule.id, { signalId: event.target.value })}>{inspectedTwinProject.signals.filter((signal) => signal.access === 'read').map((signal) => <option key={signal.id} value={signal.id}>{signal.path}</option>)}</select></label>
                        {thresholdRule && <label><span>Limit</span><input type="number" step="any" value={thresholdRule.limit} onChange={(event) => updateAlarmRule(rule.id, { limit: Number(event.target.value) })} /></label>}
                        <label><span>Priority</span><select value={rule.priority} onChange={(event) => updateAlarmRule(rule.id, { priority: event.target.value as AlarmPriority })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
                        <button type="button" className={rule.enabled ? 'active icon' : 'icon'} title={rule.enabled ? 'Disable alarm rule' : 'Enable alarm rule'} onClick={() => updateAlarmRule(rule.id, { enabled: !rule.enabled })}><Activity size={13} /></button>
                        <button type="button" className="icon danger" title="Delete alarm rule" onClick={() => deleteAlarmRule(rule.id)}><Trash2 size={13} /></button>
                        <div className={`alarm-instance-state ${instance?.state ?? 'normal'}`}><strong>{instance?.state ?? 'normal'}</strong><small>{instance?.message ?? 'Waiting for evaluation'}</small></div>
                        {instance?.state === 'active' && <button type="button" onClick={() => setAlarmInstances((current) => acknowledgeAlarm(current, instance.instanceId))}>Acknowledge</button>}
                        {instance && !['normal', 'cleared', 'shelved'].includes(instance.state) && <button type="button" onClick={() => setAlarmInstances((current) => shelveAlarm(current, instance.instanceId, new Date(Date.now() + 600_000).toISOString()))}>Shelve 10m</button>}
                      </div>;
                    })}
                    {!alarmRules.length && <p>No alarm rules configured. Add a rule and bind it to a readable TwinSignal.</p>}
                    {alarmEvents.slice(-3).reverse().map((event) => <div className={`alarm-event ${event.severity}`} key={event.id}><span>{new Date(event.timestampUtc).toLocaleTimeString()}</span><strong>{event.message}</strong></div>)}
                  </div>
                  <div className="scenario-studio" aria-label="Simulation Scenario Studio">
                    <div className="section-title-row"><h4>Scenario Studio</h4><button type="button" title="Create simulation scenario" onClick={addSimulationScenario}><Sparkles size={13} /><span>New</span></button></div>
                    {simulationScenarios.length > 0 && <label><span>Scenario</span><select value={activeScenarioId ?? ''} onChange={(event) => { setActiveScenarioId(event.target.value || undefined); setScenarioElapsedMs(0); setScenarioRunning(false); }}><option value="">Select...</option>{simulationScenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}</select></label>}
                    {activeScenario && <>
                      <div className="scenario-fields">
                        <label><span>Name</span><input value={activeScenario.name} onChange={(event) => updateSimulationScenario(activeScenario.id, { name: event.target.value })} /></label>
                        <label><span>Duration ms</span><input type="number" min="100" value={activeScenario.durationMs} onChange={(event) => updateSimulationScenario(activeScenario.id, { durationMs: Math.max(100, Number(event.target.value)) })} /></label>
                        <label className="scenario-loop"><input type="checkbox" checked={activeScenario.loop} onChange={(event) => updateSimulationScenario(activeScenario.id, { loop: event.target.checked })} /><span>Loop</span></label>
                      </div>
                      <div className="scenario-actions-list">
                        {activeScenario.actions.map((action, index) => action.kind === 'reported' ? <div key={`${activeScenario.id}-${index}`}>
                          <input aria-label={`Action ${index + 1} time`} type="number" min="0" max={activeScenario.durationMs} value={action.atMs} onChange={(event) => updateSimulationScenario(activeScenario.id, { actions: activeScenario.actions.map((item, itemIndex) => itemIndex === index ? { ...action, atMs: Number(event.target.value) } : item) })} />
                          <select aria-label={`Action ${index + 1} signal`} value={action.signalId} onChange={(event) => updateSimulationScenario(activeScenario.id, { actions: activeScenario.actions.map((item, itemIndex) => itemIndex === index ? { ...action, signalId: event.target.value } : item) })}>{inspectedTwinProject.signals.filter((signal) => signal.access === 'read').map((signal) => <option key={signal.id} value={signal.id}>{signal.path}</option>)}</select>
                          <input aria-label={`Action ${index + 1} value`} type="number" step="any" value={typeof action.value === 'number' ? action.value : Number(action.value) || 0} onChange={(event) => updateSimulationScenario(activeScenario.id, { actions: activeScenario.actions.map((item, itemIndex) => itemIndex === index ? { ...action, value: Number(event.target.value) } : item) })} />
                          <button type="button" className="icon danger" title="Delete scenario action" onClick={() => updateSimulationScenario(activeScenario.id, { actions: activeScenario.actions.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={12} /></button>
                        </div> : null)}
                      </div>
                      <button type="button" className="wide-action" onClick={() => {
                        const signal = inspectedTwinProject.signals.find((item) => item.access === 'read');
                        if (signal) updateSimulationScenario(activeScenario.id, { actions: [...activeScenario.actions, { atMs: Math.min(activeScenario.durationMs, scenarioElapsedMs), kind: 'reported', signalId: signal.id, value: 0, quality: 'SIMULATED' }] });
                      }}><Activity size={13} /><span>Add signal action</span></button>
                      <input aria-label="Scenario timeline" type="range" min="0" max={activeScenario.durationMs} value={Math.min(scenarioElapsedMs, activeScenario.durationMs)} onChange={(event) => { setScenarioRunning(false); setScenarioElapsedMs(Number(event.target.value)); }} />
                      <div className="scenario-transport">
                        <button type="button" className={scenarioRunning ? 'active' : ''} onClick={scenarioRunning ? () => setScenarioRunning(false) : runActiveScenario}>{scenarioRunning ? <Pause size={13} /> : <Play size={13} />}<span>{scenarioRunning ? 'Pause' : 'Run'}</span></button>
                        <button type="button" onClick={() => { setScenarioRunning(false); setScenarioElapsedMs(0); }}><RotateCw size={13} /><span>Reset</span></button>
                        <strong>{Math.round(scenarioElapsedMs)} / {activeScenario.durationMs} ms</strong>
                      </div>
                      <div className="scenario-status"><span>{scenarioFrame?.appliedActionIndexes.length ?? 0} actions applied</span><strong>{scenarioFrame?.complete ? 'COMPLETE' : scenarioRunning ? 'RUNNING' : 'READY'}</strong><code>SIMULATION ONLY | no adapter writes</code></div>
                    </>}
                    {!simulationScenarios.length && <p>No scenarios. Create one from a readable TwinSignal.</p>}
                  </div>
                  <div className="twin-operational-detail" aria-label="Operational state details">
                    <h4>Operational State</h4>
                    <div><span>Authority</span><strong>{plcDashboard.openPlc.enabled ? 'OpenPLC' : plcDashboard.localManualActive ? 'Local manual' : 'Internal PLC'}</strong></div>
                    <div><span>Mode</span><strong>{['MANUAL / HOLD', 'AUTO', 'HOME'][plcDashboard.openPlc.command] ?? 'UNKNOWN'}</strong></div>
                    <div><span>Condition</span><strong>{plcConditionState ?? '--'}</strong></div>
                    <div><span>Alarm</span><strong>{plcAlarmCode ?? '--'}</strong></div>
                  </div>
                  <div className="twin-activity-list">
                    <h4>Connections</h4>
                    {inspectedTwinProject.connectionHealth.slice(0, 4).map((connection) => (
                      <div key={connection.connectionId}><span>{connection.protocol.toUpperCase()}</span><strong className={connection.state.toLowerCase()}>{connection.state}</strong><small>{connection.message ?? connection.connectionId}</small></div>
                    ))}
                    {!inspectedTwinProject.connectionHealth.length && <p>No connection telemetry.</p>}
                    <h4>Recent Events</h4>
                    {inspectedTwinProject.events.slice(-4).reverse().map((event) => (
                      <div key={event.id}><span>{event.type}</span><strong className={event.severity}>{event.severity}</strong><small>{event.message}</small></div>
                    ))}
                    {!inspectedTwinProject.events.length && <p>No runtime events recorded.</p>}
                    <h4>Recent Commands</h4>
                    {inspectedTwinProject.commands.slice(-3).reverse().map((command) => (
                      <div key={command.id}><span>{command.signalId}</span><strong>{command.status}</strong><small>{String(command.requestedValue)}</small></div>
                    ))}
                    {!inspectedTwinProject.commands.length && <p>No governed commands recorded.</p>}
                  </div>
                </section>
              )}
              {inspectorFocus === 'twin' && !inspectedTwinProject && (
                <div className="inspector-stage-empty">
                  <Activity size={18} />
                  <strong>Sin modelo Twin operativo</strong>
                  <p>Abre Mecanica, analiza las articulaciones y guarda la configuracion para preparar sus senales y bindings.</p>
                  <button type="button" onClick={() => setInspectorFocus('mechanics')}>Ir a Mecanica</button>
                </div>
              )}

              {inspectorFocus === 'parts' && selectedNode.geometry.kind === 'imported-model' && (
                <section>
                  <div className="section-title-row">
                    <h3>Parts Editor</h3>
                    <span className="part-selection-count">{selectedPartsForSelectedNode.length} selected</span>
                  </div>
                  <div className="part-mode-controls">
                    <button className={tool === 'parts' && partEditMode === 'free' ? 'active' : ''} title="Free part drag" onClick={() => {
                      if (tool === 'parts' && partEditMode === 'free') {
                        setTool('select');
                        setStatus('Parts mode cleared');
                        return;
                      }
                      setTool('parts');
                      setPartEditMode('free');
                    }}>
                      <Cuboid size={16} />
                    </button>
                    <button className={tool === 'parts' && partEditMode === 'translate' ? 'active' : ''} title="Part move" onClick={() => {
                      setTool('parts');
                      setPartEditMode('translate');
                    }}>
                      <Move3D size={16} />
                    </button>
                    <button className={tool === 'parts' && partEditMode === 'rotate' ? 'active' : ''} title="Part rotate" onClick={() => {
                      setTool('parts');
                      setPartEditMode('rotate');
                    }}>
                      <RotateCw size={16} />
                    </button>
                    <button className={tool === 'parts' && partEditMode === 'scale' ? 'active' : ''} title="Part scale" onClick={() => {
                      setTool('parts');
                      setPartEditMode('scale');
                    }}>
                      <Scaling size={16} />
                    </button>
                  </div>
                  <div className="material-presets expanded">
                    {materialPresets.map((preset) => (
                      <button
                        key={`part-${preset.name}`}
                        title={`Apply ${preset.name} to selected parts`}
                        className="swatch"
                        disabled={!selectedPartsForSelectedNode.length}
                        style={{ backgroundColor: preset.color }}
                        onClick={() => updateSelectedPartColor(preset.color)}
                      >
                        <Palette size={14} />
                      </button>
                    ))}
                  </div>
                  <label className="field-row">
                    <span>Custom part</span>
                    <input type="color" disabled={!selectedPartsForSelectedNode.length} onChange={(event) => updateSelectedPartColor(event.target.value)} />
                    <span className="color-value">{selectedPartsForSelectedNode.length ? 'picker' : 'select parts'}</span>
                  </label>
                  <div className="part-store-actions">
                    <button title="Store selected parts" disabled={!selectedPartsForSelectedNode.length} onClick={() => storePartsInWarehouse('selected')}>
                      <Save size={16} />
                      <span>Store Selected</span>
                    </button>
                    <button
                      title="Update selected warehouse part from current scene piece"
                      disabled={!selectedWarehouseItem || selectedWarehouseItem.itemType !== 'part' || !selectedNode}
                      onClick={() => updateWarehouseItemFromSelection(false)}
                    >
                      <Save size={16} />
                      <span>Update Stored</span>
                    </button>
                    <button
                      title="Save modified scene piece as new warehouse part"
                      disabled={!selectedWarehouseItem || selectedWarehouseItem.itemType !== 'part' || !selectedNode}
                      onClick={() => updateWarehouseItemFromSelection(true)}
                    >
                      <Copy size={16} />
                      <span>Save Copy</span>
                    </button>
                    <button title="Dismantle detected model parts into warehouse" disabled={!selectedNode.geometry.joints.length} onClick={() => storePartsInWarehouse('all')}>
                      <Cuboid size={16} />
                      <span>Dismantle Model</span>
                    </button>
                  </div>
                </section>
              )}

              {inspectorFocus === 'parts' && selectedNode.geometry.kind === 'serialized-object' && (
                <section>
                  <div className="section-title-row">
                    <h3>Stored Part</h3>
                    <span className="part-selection-count">Warehouse object</span>
                  </div>
                  <div className="part-store-actions">
                    <button
                      title="Update selected warehouse part from current scene piece"
                      disabled={!selectedWarehouseItem || selectedWarehouseItem.itemType !== 'part'}
                      onClick={() => updateWarehouseItemFromSelection(false)}
                    >
                      <Save size={16} />
                      <span>Update Stored</span>
                    </button>
                    <button
                      title="Save modified scene piece as new warehouse part"
                      disabled={!selectedWarehouseItem || selectedWarehouseItem.itemType !== 'part'}
                      onClick={() => updateWarehouseItemFromSelection(true)}
                    >
                      <Copy size={16} />
                      <span>Save Copy</span>
                    </button>
                  </div>
                </section>
              )}
              {inspectorFocus === 'parts' && !['imported-model', 'serialized-object'].includes(selectedNode.geometry.kind) && (
                <div className="inspector-stage-empty">
                  <Cuboid size={18} />
                  <strong>Este objeto no contiene piezas importadas</strong>
                  <p>Selecciona un modelo GLB, FBX u OBJ compuesto para editar, desmontar y almacenar sus piezas.</p>
                </div>
              )}

              {inspectorFocus === 'mechanics' && <GeometryInspector
                node={selectedNode}
                setGeometryValue={setGeometryValue}
                setImportedJointMotion={setImportedJointMotion}
                resetImportedJointPose={resetImportedJointPose}
                normalizeImportedModel={normalizeImportedModel}
                demoActive={demoMotionNodeId === selectedNode.id}
                toggleImportedMotionDemo={toggleImportedMotionDemo}
                trainingCandidate={currentMotionCandidate?.nodeId === selectedNode.id ? currentMotionCandidate : undefined}
                trainingProgress={currentMotionCandidate?.nodeId === selectedNode.id ? trainingProgress : undefined}
                startMotionTrainer={startMotionTrainer}
                acceptMotionTest={acceptMotionTest}
                rejectMotionTest={rejectMotionTest}
                stopMotionTrainer={stopMotionTrainer}
                moveValidatedMotion={moveValidatedMotion}
                removeValidatedMotion={removeValidatedMotion}
                selectedPartNames={selectedPartsForSelectedNode.map((part) => part.objectName)}
                setKinematicJointValue={setKinematicJointValueForNode}
                setKinematicJointValues={setKinematicJointValuesForNode}
                resetKinematicPose={resetKinematicPoseForNode}
                updateKinematicJoint={updateKinematicJointForNode}
                updateKinematicGraph={updateKinematicGraphForNode}
                startKinematicEdit={startKinematicEditForNode}
                acceptKinematicJoint={acceptKinematicJointForNode}
                commitKinematicJointFrame={commitKinematicJointFrameForNode}
                rejectKinematicJoint={rejectKinematicJointForNode}
                deleteKinematicJoint={deleteKinematicJointForNode}
                createKinematicJoint={createKinematicJointForNode}
                saveKinematicConfiguration={save}
                robotCursorGuideActive={robotCursorGuideNodeId === selectedNode.id}
                toggleRobotCursorGuide={toggleRobotCursorGuideForNode}
                randomizeGenerator={randomizeGenerator}
              />}
            </>
          ) : (
            <div className="empty-state">Select an object in the viewport or scene tree.</div>
          )}

          {inspectorFocus === 'export' && <section className="inspector-stage-section">
            <div className="section-title-row">
              <h3>Export Center</h3>
              <button title="Run preflight" onClick={runPreflight}>
                <ShieldCheck size={16} />
              </button>
            </div>

            <label className="field-row">
              <span>Preset</span>
              <select value={exportProfileId} onChange={(event) => setExportProfileId(event.target.value as ExportProfileId)}>
                {exportProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="export-profile-card">
              <strong>{getExportProfile(exportProfileId).engine}</strong>
              <span>{getExportProfile(exportProfileId).notes.join(' | ')}</span>
            </div>

            <div className="export-actions">
              <button title="Render preview" onClick={renderPreview}>
                <Eye size={16} />
                <span>Preview</span>
              </button>
              <button title="Export GLB" className="primary" onClick={exportGlb}>
                <Download size={16} />
                <span>GLB</span>
              </button>
              {exportReport && (
                <button
                  title="Download last report"
                  onClick={async () => {
                    const reportName = exportReport.fileName.replace(/\.glb$/, '.export-report.json');
                    if (desktopRuntime) {
                      await saveJsonNative(exportReport, reportName);
                    } else {
                      exportJsonReport(exportReport, reportName);
                    }
                  }}
                >
                  <FileJson size={16} />
                </button>
              )}
            </div>

            {previewUrl && (
              <button className="preview-frame" title="Save preview PNG" onClick={savePreview}>
                <img src={previewUrl} alt="Export preview" />
              </button>
            )}

            {exportReport && (
              <div className={`export-report ${exportReport.status}`}>
                <strong>{exportReport.status.toUpperCase()}</strong>
                <span>{exportReport.fileSizeKb} KB</span>
                <span>{exportReport.triangleEstimate.toLocaleString()} tris</span>
                <span>{exportReport.visibleObjects} visible</span>
              </div>
            )}
          </section>}
        </aside>
      </section>
      ) : (

      <section className="warehouse-dashboard" onClick={() => setWarehouseMenu(undefined)}>
        <div className="warehouse-dashboard-head">
          <div>
            <h2>Parts Warehouse</h2>
            <p>
              {document.partWarehouse?.length ?? 0} visible items | {warehouseStorageInfo.items} saved | {formatGigabytes(warehouseStorageInfo.usageBytes)}
              {warehouseStorageInfo.quotaBytes ? ` / ${formatGigabytes(warehouseStorageInfo.quotaBytes)}` : ''}
            </p>
            <div className="warehouse-storage-ledger">
              {warehouseStorageInfo.savedItems.length ? (
                warehouseStorageInfo.savedItems.map((item, index) => (
                  <span key={`${item.name}-${item.savedAt}-${index}`}>
                    {item.name} | {item.itemType} | {formatGigabytes(item.sizeBytes)}
                  </span>
                ))
              ) : (
                <span>No permanent objects saved for this project</span>
              )}
            </div>
          </div>
          <div className="warehouse-dashboard-actions">
            <label className="warehouse-search"><Focus size={14} /><input aria-label="Search functional library" placeholder="Search code, name, class..." value={warehouseQuery} onChange={(event) => setWarehouseQuery(event.target.value)} /></label>
            <div className="warehouse-type-filter" aria-label="Warehouse item type filter">
              <button type="button" className={warehouseTypeFilter === 'all' ? 'active' : ''} onClick={() => setWarehouseTypeFilter('all')}>All</button>
              <button type="button" className={warehouseTypeFilter === 'part' ? 'active' : ''} onClick={() => setWarehouseTypeFilter('part')}>Parts</button>
              <button type="button" className={warehouseTypeFilter === 'assembly' ? 'active' : ''} onClick={() => setWarehouseTypeFilter('assembly')}>Assemblies</button>
            </div>
            <button title="Send selected warehouse item to scene" disabled={!selectedWarehouseItem} onClick={() => selectedWarehouseItem && addWarehouseItemToScene(selectedWarehouseItem)}>
              <Import size={16} />
              <span>To Scene</span>
            </button>
            <button title="Delete selected warehouse item" disabled={!selectedWarehouseItem} onClick={() => selectedWarehouseItem && deleteWarehouseItem(selectedWarehouseItem.id)}>
              <Trash2 size={16} />
              <span>Delete</span>
            </button>
            <button title="Save selected item permanently in this project warehouse" disabled={!selectedWarehouseItem} onClick={saveSelectedWarehousePermanent}>
              <Save size={16} />
              <span>Save Item</span>
            </button>
            <button title="Save all new warehouse items permanently in this project warehouse" disabled={!(document.partWarehouse?.length)} onClick={saveAllWarehousePermanent}>
              <ShieldCheck size={16} />
              <span>Save All</span>
            </button>
            <button title="Load permanent project warehouse objects" onClick={loadPermanentWarehouseIntoProject}>
              <FolderOpen size={16} />
              <span>Load Saved</span>
            </button>
            <button
              title="Save current scene imported parts separately"
              disabled={!document.nodes.some((node) => node.geometry.kind === 'imported-model' || node.geometry.kind === 'serialized-object')}
              onClick={storeScenePartsSeparately}
            >
              <Save size={16} />
              <span>Store Scene Parts</span>
            </button>
            <button
              title="Save scene imported parts as composite assembly"
              disabled={document.nodes.filter((node) => node.geometry.kind === 'imported-model' || node.geometry.kind === 'serialized-object').length < 2}
              onClick={storeSceneAssembly}
            >
              <Copy size={16} />
              <span>Store Assembly</span>
            </button>
            <button title="Export warehouse project" disabled={!(document.partWarehouse?.length)} onClick={exportWarehouseProject}>
              <Download size={16} />
              <span>Export Warehouse</span>
            </button>
            <button title="Import warehouse project" onClick={() => warehouseInputRef.current?.click()}>
              <FolderOpen size={16} />
              <span>Import Warehouse</span>
            </button>
            <input ref={warehouseInputRef} type="file" accept=".json,.warehouse.json" hidden onChange={importWarehouseProject} />
          </div>
        </div>

        <div className="warehouse-dashboard-body">
          {warehouseGroups.length ? (
            warehouseGroups.map((group) => (
              <div key={group.category} className="warehouse-rack">
                <div className="warehouse-rack-title">
                  <strong>{group.category}</strong>
                  <span>{group.classes.reduce((total, partClass) => total + partClass.items.length, 0)} items</span>
                </div>
                <div className="warehouse-rack-classes">
                  {group.classes.map((partClass) => (
                    <div key={`${group.category}-${partClass.className}`} className="warehouse-class-column">
                      <div className="warehouse-class-label">
                        <span>{partClass.className}</span>
                        <small>{partClass.items.length}</small>
                      </div>
                      <div className="warehouse-bin-grid dashboard">
                        {partClass.items.map((item) => (
                          <button
                            key={item.id}
                            className={item.id === document.selectedWarehouseItemId ? 'warehouse-bin selected' : 'warehouse-bin'}
                            title={`${item.code} - ${item.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              selectWarehouseItem(item.id);
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              selectWarehouseItem(item.id);
                              setWarehouseMenu({ itemId: item.id, x: event.clientX, y: event.clientY });
                            }}
                            onDoubleClick={() => addWarehouseItemToScene(item)}
                          >
                            {item.thumbnailDataUrl ? (
                              <img src={item.thumbnailDataUrl} alt="" />
                            ) : (
                              <Cuboid size={28} />
                            )}
                            <small>{item.code}</small>
                            <span>{item.name}</span>
                            <em>{functionalWarehouseSummary(item)}</em>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="warehouse-empty-dashboard">No stored parts yet.</div>
          )}
        </div>
        {selectedWarehouseItem && <aside className="functional-library-inspector" aria-label="Functional library inspector" onClick={(event) => event.stopPropagation()}>
          <header><div><strong>{selectedWarehouseItem.name}</strong><small>{selectedWarehouseItem.code} | {selectedWarehouseItem.itemType}</small></div><button type="button" title="Close component inspector" onClick={() => setDocument((current) => ({ ...current, selectedWarehouseItemId: undefined }))}><X size={15} /></button></header>
          {selectedWarehouseItem.itemType === 'part' && selectedWarehouseItem.functionalComponent ? <>
            <section className="component-identity-grid">
              <label><span>Name</span><input value={selectedWarehouseItem.functionalComponent.name} onChange={(event) => updateSelectedFunctionalComponent({ name: event.target.value })} /></label>
              <label><span>Category</span><input value={selectedWarehouseItem.functionalComponent.category} onChange={(event) => updateSelectedFunctionalComponent({ category: event.target.value })} /></label>
              <label><span>Class</span><input value={selectedWarehouseItem.functionalComponent.className} onChange={(event) => updateSelectedFunctionalComponent({ className: event.target.value })} /></label>
              <label><span>Role</span><select value={selectedWarehouseItem.functionalComponent.mechanicalProperties.role} onChange={(event) => updateSelectedFunctionalComponent({ mechanicalProperties: { ...selectedWarehouseItem.functionalComponent!.mechanicalProperties, role: event.target.value as FunctionalComponent['mechanicalProperties']['role'] } })}><option value="base">Base</option><option value="link">Link</option><option value="joint">Joint</option><option value="end-effector">End effector</option><option value="drive">Drive</option><option value="panel">Panel</option><option value="generic">Generic</option></select></label>
            </section>
            <div className="component-metrics"><span><b>{selectedWarehouseItem.functionalComponent.interfaces.length}</b> interfaces</span><span><b>{selectedWarehouseItem.functionalComponent.twinProperties?.length ?? 0}</b> properties</span><span><b>{selectedWarehouseItem.functionalComponent.mechanicalProperties.massEstimateKg?.toFixed(3) ?? '--'}</b> kg est.</span></div>
            <h3>Mechanical Interfaces</h3>
            <div className="mechanical-interface-list">
              {selectedWarehouseItem.functionalComponent.interfaces.map((item) => <div key={item.id}>
                <input aria-label={`${item.id} name`} value={item.name} onChange={(event) => updateSelectedMechanicalInterface(item.id, { name: event.target.value, source: 'manual' })} />
                <select aria-label={`${item.id} kind`} value={item.kind} onChange={(event) => updateSelectedMechanicalInterface(item.id, { kind: event.target.value as MechanicalInterfaceKind, source: 'manual', confidence: 1 })}>{(['axis', 'hinge', 'support', 'rail', 'shaft', 'mount', 'gripper', 'surface'] as MechanicalInterfaceKind[]).map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>
                <code>{item.axis?.map((value) => value.toFixed(2)).join(', ') ?? 'frame'}</code><strong>{Math.round(item.confidence * 100)}%</strong>
              </div>)}
            </div>
          </> : selectedWarehouseItem.itemType === 'assembly' && selectedWarehouseItem.functionalAssembly ? <>
            <div className={`assembly-validation-banner ${selectedWarehouseItem.functionalAssembly.metadata.validationStatus}`}><ShieldCheck size={15} /><span><strong>{selectedWarehouseItem.functionalAssembly.metadata.validationStatus.toUpperCase()}</strong><small>{selectedWarehouseItem.functionalAssembly.components.length} components | {selectedWarehouseItem.functionalAssembly.connections.length} connections</small></span></div>
            <h3>Assembly Connections</h3>
            <div className="assembly-connection-list">
              {selectedWarehouseItem.functionalAssembly.connections.map((connection) => <div key={connection.id} className={`assembly-connection ${connection.status}`}>
                <header><strong>{connection.name}</strong><select value={connection.status} onChange={(event) => updateSelectedAssemblyConnection(connection.id, (current) => ({ ...current, status: event.target.value as AssemblyConnection['status'] }))}><option value="candidate">Candidate</option><option value="validated">Validated</option><option value="manual">Manual</option><option value="rejected">Rejected</option></select></header>
                <label><span>Joint</span><select value={connection.joint.type} onChange={(event) => updateSelectedAssemblyConnection(connection.id, (current) => ({ ...current, source: 'manual', status: 'manual', joint: { ...current.joint, type: event.target.value as AssemblyConnection['joint']['type'], limits: event.target.value === 'fixed' ? undefined : current.joint.limits ?? { lower: -1, upper: 1 } } }))}><option value="fixed">Fixed</option><option value="revolute">Revolute</option><option value="continuous">Continuous</option><option value="prismatic">Prismatic</option></select></label>
                <div className="connection-axis">{connection.joint.axis.map((value, index) => <label key={index}><span>{['X', 'Y', 'Z'][index]}</span><input type="number" step="0.1" value={value} onChange={(event) => updateSelectedAssemblyConnection(connection.id, (current) => ({ ...current, source: 'manual', status: 'manual', joint: { ...current.joint, axis: current.joint.axis.map((axisValue, axisIndex) => axisIndex === index ? Number(event.target.value) : axisValue) as [number, number, number] } }))} /></label>)}</div>
                {connection.joint.limits && <div className="connection-limits"><label><span>Lower</span><input type="number" step="0.01" value={connection.joint.limits.lower ?? 0} onChange={(event) => updateSelectedAssemblyConnection(connection.id, (current) => ({ ...current, source: 'manual', status: 'manual', joint: { ...current.joint, limits: { ...current.joint.limits!, lower: Number(event.target.value) } } }))} /></label><label><span>Upper</span><input type="number" step="0.01" value={connection.joint.limits.upper ?? 0} onChange={(event) => updateSelectedAssemblyConnection(connection.id, (current) => ({ ...current, source: 'manual', status: 'manual', joint: { ...current.joint, limits: { ...current.joint.limits!, upper: Number(event.target.value) } } }))} /></label></div>}
                <small>{connection.parentComponentId} {'->'} {connection.childComponentId} | confidence {Math.round(connection.confidence * 100)}%</small>
              </div>)}
            </div>
            <h3>Validation</h3>
            <div className="assembly-validation-list">{selectedWarehouseItem.functionalAssembly.metadata.validationMessages.length ? selectedWarehouseItem.functionalAssembly.metadata.validationMessages.map((message) => <div key={message}><AlertTriangle size={12} /><span>{message}</span></div>) : <div><Check size={12} /><span>No assembly issues detected.</span></div>}</div>
          </> : <div className="empty-state compact">This legacy item has no functional metadata. Re-store it to generate a FunctionalComponent.</div>}
        </aside>}
      </section>
      )}

      {warehouseMenu && (
        <div className="warehouse-context-menu" style={{ left: warehouseMenu.x, top: warehouseMenu.y }} onClick={(event) => event.stopPropagation()}>
          {(() => {
            const item = document.partWarehouse?.find((entry) => entry.id === warehouseMenu.itemId);
            if (!item) return null;
            return (
              <>
                <button onClick={() => addWarehouseItemToScene(item)}>
                  <Import size={15} />
                  <span>Send to scene</span>
                </button>
                <button onClick={() => saveWarehouseItemsPermanent([item], 'selected item')}>
                  <Save size={15} />
                  <span>Save permanently</span>
                </button>
                <button onClick={() => deleteWarehouseItem(item.id)}>
                  <Trash2 size={15} />
                  <span>Delete from warehouse</span>
                </button>
              </>
            );
          })()}
        </div>
      )}

      {workspaceMenu && activeView === 'workspace' && (
        <div
          className={`viewport-context-menu ${workspaceMenuJoint ? 'joint-menu' : 'part-menu'}`}
          style={{ left: Math.min(workspaceMenu.x, window.innerWidth - 286), top: Math.min(workspaceMenu.y, window.innerHeight - 420) }}
          onClick={(event) => event.stopPropagation()}
        >
          {workspaceMenuJoint ? (
            <>
              <div className="viewport-context-head">
                <strong>{workspaceMenuJoint.name}</strong>
                <span>{workspaceMenuJoint.type} | {workspaceMenuJoint.status === 'validated' ? 'Validated' : workspaceMenuJoint.status === 'rejected' ? 'Rejected' : 'Candidate'}</span>
                {workspaceMenuJoint.type !== 'fixed' && (
                  <span>
                    Range: {workspaceMenuJoint.type === 'prismatic'
                      ? `${workspaceMenuJoint.limits?.lower ?? -1} to ${workspaceMenuJoint.limits?.upper ?? 1} model units`
                      : `${Number(THREE.MathUtils.radToDeg(workspaceMenuJoint.limits?.lower ?? (workspaceMenuJoint.type === 'continuous' ? -Math.PI * 2 : -Math.PI)).toFixed(2))} to ${Number(THREE.MathUtils.radToDeg(workspaceMenuJoint.limits?.upper ?? (workspaceMenuJoint.type === 'continuous' ? Math.PI * 2 : Math.PI)).toFixed(2))} deg`}
                  </span>
                )}
              </div>
              {workspaceMenuJointIds.length > 1 && (
                <div className="nearby-joints">
                  <span>Joints here</span>
                  {workspaceMenuJointIds.slice(0, 4).map((jointId) => {
                    const joint = workspaceMenuGraph?.joints.find((item) => item.id === jointId);
                    return (
                      <button key={jointId} title={`Select ${joint?.name ?? jointId}`} onClick={() => setWorkspaceMenu({ ...workspaceMenu, jointId })}>
                        {joint?.name ?? jointId}
                      </button>
                    );
                  })}
                </div>
              )}
              {workspaceMenuJoint.type === 'fixed' ? (
                <div className="context-note">Fixed Joint. No relative movement.</div>
              ) : (
                <>
                  <button title="Set the minimum and maximum movement allowed for this joint and store it with the model." onClick={() => openJointRangeEditor(workspaceMenu.nodeId, workspaceMenuJoint)}>
                    <Settings2 size={15} />
                    <span>Edit Movement Range</span>
                  </button>
                  {jointRangeEditor?.nodeId === workspaceMenu.nodeId && jointRangeEditor.jointId === workspaceMenuJoint.id && (
                    <div className="joint-range-editor" data-testid="joint-range-editor">
                      <div className="joint-range-editor-head">
                        <strong>Allowed movement</strong>
                        <span>{workspaceMenuJoint.type === 'prismatic' ? 'Model units' : 'Degrees'}</span>
                      </div>
                      <label>
                        <span>Minimum</span>
                        <input aria-label="Joint range minimum" type="number" step={workspaceMenuJoint.type === 'prismatic' ? 0.01 : 1} value={jointRangeEditor.lower} onChange={(event) => setJointRangeEditor((current) => current ? { ...current, lower: event.target.value, error: undefined } : current)} />
                      </label>
                      <label>
                        <span>Maximum</span>
                        <input aria-label="Joint range maximum" type="number" step={workspaceMenuJoint.type === 'prismatic' ? 0.01 : 1} value={jointRangeEditor.upper} onChange={(event) => setJointRangeEditor((current) => current ? { ...current, upper: event.target.value, error: undefined } : current)} />
                      </label>
                      {jointRangeEditor.error && <div className="joint-range-error" role="alert">{jointRangeEditor.error}</div>}
                      <div className="joint-range-actions">
                        <button className="primary" title="Validate and store this movement range in the model kinematic graph." onClick={saveJointRange}>
                          <Save size={14} />
                          <span>Save Range</span>
                        </button>
                        <button title="Discard the range values currently being edited." onClick={() => setJointRangeEditor(undefined)}>
                          <X size={14} />
                          <span>Cancel</span>
                        </button>
                      </div>
                    </div>
                  )}
                  <button title="Runs a safe movement sequence for this joint so you can visually verify whether its mechanical behavior is correct." onClick={() => startViewportJointTest(workspaceMenu.nodeId, workspaceMenuJoint.id, 'movement')}>
                    <Play size={15} />
                    <span>Test Movement</span>
                  </button>
                  <button title="Moves the joint through its configured range while respecting its limits and safe caps." onClick={() => startViewportJointTest(workspaceMenu.nodeId, workspaceMenuJoint.id, 'full-range')}>
                    <Activity size={15} />
                    <span>Test Full Range</span>
                  </button>
                </>
              )}
              <button title="Confirms that the observed movement matches the intended mechanical behavior." onClick={() => confirmViewportJointCorrect(workspaceMenu.nodeId, workspaceMenuJoint.id)}>
                <Check size={15} />
                <span>Movement Correct</span>
              </button>
              <button title="Starts a guided repair flow for this joint." onClick={() => markViewportJointIncorrect(workspaceMenu.nodeId, workspaceMenuJoint.id)}>
                <X size={15} />
                <span>Movement Incorrect</span>
              </button>
              <button title="Focuses the camera on this joint and displays its pivot, axis, parent, child and affected chain." onClick={() => startKinematicEditForNode(workspaceMenu.nodeId, workspaceMenuJoint.id, 'show-joint')}>
                <Eye size={15} />
                <span>Show Joint</span>
              </button>
              <button title="Shows the current joint axis in the viewport." onClick={() => startKinematicEditForNode(workspaceMenu.nodeId, workspaceMenuJoint.id, 'axis-gizmo')}>
                <Move3D size={15} />
                <span>Show Axis</span>
              </button>
              <button title="Returns the whole mechanism to its defined home configuration." onClick={() => resetKinematicPoseForNode(workspaceMenu.nodeId)}>
                <RotateCw size={15} />
                <span>Return Home</span>
              </button>
              {viewportInspection.inspectedJointIds?.length && (
                <button title="Move to the next joint in the current inspection." onClick={nextInspectionJoint}>
                  <ArrowDown size={15} />
                  <span>Next Joint</span>
                </button>
              )}
              <button title="Open the Advanced Joint Inspector in the side panel with raw IDs, vectors, limits, evidence and coupling controls." onClick={() => setWorkspaceMenu(undefined)}>
                <Focus size={15} />
                <span>Advanced...</span>
              </button>
              {pieceAnalysis?.nodeId === workspaceMenu.nodeId ? (
                <>
                  <button title="Open guided correction for this isolated piece movement." onClick={() => preparePieceMotionCorrection(workspaceMenu.nodeId)}>
                    <Hammer size={15} />
                    <span>Correct Movement</span>
                  </button>
                  <button title="Close isolated piece analysis and return to the complete object workspace." onClick={() => void exitPieceAnalysis(true)}>
                    <ArrowUp size={15} />
                    <span>Exit piece mode</span>
                  </button>
                </>
              ) : (
                <button title="Open this clicked part alone in piece analysis mode. Double click on the part does the same." onClick={() => void enterPieceAnalysis(workspaceMenu)}>
                  <Focus size={15} />
                  <span>Analyze piece</span>
                </button>
              )}
            </>
          ) : (
            <>
              <div className="viewport-context-head">
                <strong>Part: {workspaceMenu.objectName ?? workspaceMenuNode?.name ?? 'Object'}</strong>
                <span>{pieceAnalysis?.nodeId === workspaceMenu.nodeId ? 'Piece analysis' : 'No joint selected'}</span>
              </div>
              {pieceAnalysis?.nodeId === workspaceMenu.nodeId ? (
                <button title="Open guided correction for this isolated piece movement." onClick={() => preparePieceMotionCorrection(workspaceMenu.nodeId)}>
                  <Hammer size={15} />
                  <span>Correct Movement</span>
                </button>
              ) : (
                <button title="Open this part alone in piece analysis mode. Double click on the part does the same." onClick={() => void enterPieceAnalysis(workspaceMenu)}>
                  <Focus size={15} />
                  <span>Analyze piece</span>
                </button>
              )}
              <button
                title="Create a joint at the clicked point. Use another click on the other end if this same piece needs another joint."
                onClick={() =>
                  workspaceMenu.objectName &&
                  createKinematicJointForNode(workspaceMenu.nodeId, [workspaceMenu.objectName], {
                    origin: workspaceMenu.point ?? workspaceMenu.objectCenter,
                    drivenPoint: workspaceMenu.objectCenter,
                  })
                }
              >
                <Hammer size={15} />
                <span>Create Joint Here</span>
              </button>
              <button title="Focuses the selected object in the viewport." onClick={() => workspaceMenuNode && selectNode(workspaceMenuNode.id)}>
                <Eye size={15} />
                <span>Show Part</span>
              </button>
              <button title="Save this object to the current project warehouse." onClick={() => saveWorkspaceItemPermanent(workspaceMenu.nodeId)}>
                <Save size={15} />
                <span>Save object to project</span>
              </button>
              <button title="Save the current scene objects as a reusable set." onClick={saveWorkspaceAssemblyPermanent}>
                <Copy size={15} />
                <span>Save scene set</span>
              </button>
              {pieceAnalysis?.nodeId === workspaceMenu.nodeId && (
                <button title="Close isolated piece analysis and return to the complete object workspace." onClick={() => void exitPieceAnalysis(true)}>
                  <ArrowUp size={15} />
                  <span>Exit piece mode</span>
                </button>
              )}
            </>
          )}
        </div>
      )}

      <aside
        className={`modbus-controller-drawer ${modbusControllerDrawerOpen ? 'open' : 'closed'}`}
        style={{ width: `min(${modbusControllerDrawerWidth}px, calc(100vw - 22px))` }}
        aria-label="Digital Twin Modbus Controller"
        aria-hidden={!modbusControllerDrawerOpen}
      >
        <div
          className="drawer-width-resize-handle"
          role="separator"
          aria-label="Resize IoT Control Center width"
          aria-orientation="vertical"
          onPointerDown={(event) => {
            drawerResizeRef.current = { kind: 'iot', pointerId: event.pointerId, startX: event.clientX, startWidth: modbusControllerDrawerWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const resize = drawerResizeRef.current;
            if (!resize || resize.kind !== 'iot' || resize.pointerId !== event.pointerId) return;
            setModbusControllerDrawerWidth(Math.max(420, Math.min(window.innerWidth - 22, resize.startWidth + resize.startX - event.clientX)));
          }}
          onPointerUp={(event) => { drawerResizeRef.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId); }}
        />
        <div className="modbus-controller-drawer-head">
          <div>
            <strong>IoT &amp; Modbus Control Center</strong>
            <span>BLE sensors, HR registers and digital-twin connections</span>
          </div>
          <button type="button" title="Hide controller" aria-label="Hide Modbus Controller" onClick={() => setModbusControllerDrawerOpen(false)}>
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="modbus-controller-drawer-body">
          {modbusControllerUrl ? (
            <iframe
              title="Digital Twin Modbus Controller"
              src={modbusControllerUrl}
              allow="bluetooth; gamepad"
            />
          ) : (
            <div className="modbus-controller-loading">
              <Settings2 size={22} />
              <strong>{modbusControllerLaunching ? 'Starting controller...' : 'Controller is not running'}</strong>
              <span>{modbusControllerLaunching ? 'Checking 127.0.0.1:8765' : 'Use the arrow to try again.'}</span>
            </div>
          )}
        </div>
      </aside>

      <aside
        className={`trace-audit-drawer ${traceAuditDrawerOpen ? 'open' : 'closed'}`}
        style={{ width: `min(${traceAuditDrawerWidth}px, calc(100vw - 22px))` }}
        aria-label="Deep movement traceability audit"
        aria-hidden={!traceAuditDrawerOpen}
      >
        <div
          className="drawer-width-resize-handle"
          role="separator"
          aria-label="Resize traceability audit width"
          aria-orientation="vertical"
          onPointerDown={(event) => {
            drawerResizeRef.current = { kind: 'audit', pointerId: event.pointerId, startX: event.clientX, startWidth: traceAuditDrawerWidth };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const resize = drawerResizeRef.current;
            if (!resize || resize.kind !== 'audit' || resize.pointerId !== event.pointerId) return;
            setTraceAuditDrawerWidth(Math.max(520, Math.min(window.innerWidth - 22, resize.startWidth + resize.startX - event.clientX)));
          }}
          onPointerUp={(event) => { drawerResizeRef.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId); }}
        />
        {traceAuditDrawerOpen && (
          <TraceAuditDashboard
            node={plcControlledKinematicNode ?? selectedKinematicNode}
            state={plcDashboard}
            onClose={() => setTraceAuditDrawerOpen(false)}
          />
        )}
      </aside>

      <button
        type="button"
        className={`modbus-controller-edge-toggle ${modbusControllerDrawerOpen ? 'drawer-open' : ''}`}
        style={modbusControllerDrawerOpen ? { right: `min(${modbusControllerDrawerWidth}px, calc(100vw - 22px))` } : undefined}
        title={modbusControllerDrawerOpen ? 'Hide Modbus Controller' : 'Show Modbus Controller'}
        aria-label={modbusControllerDrawerOpen ? 'Hide Modbus Controller' : 'Show Modbus Controller'}
        onClick={() => modbusControllerDrawerOpen ? setModbusControllerDrawerOpen(false) : void openModbusController()}
      >
        {modbusControllerDrawerOpen ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
      </button>

      <button
        type="button"
        className={`trace-audit-edge-toggle ${traceAuditDrawerOpen ? 'drawer-open' : ''}`}
        style={traceAuditDrawerOpen ? { right: `min(${traceAuditDrawerWidth}px, calc(100vw - 22px))` } : undefined}
        title={traceAuditDrawerOpen ? 'Hide traceability audit' : 'Show deep movement traceability audit'}
        aria-label={traceAuditDrawerOpen ? 'Hide traceability audit' : 'Show deep movement traceability audit'}
        onClick={() => traceAuditDrawerOpen ? setTraceAuditDrawerOpen(false) : void openTraceAudit()}
      >
        {traceAuditDrawerOpen ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
      </button>

      <button
        type="button"
        className={`internal-settings-toggle ${internalSettingsOpen ? 'active' : ''}`}
        title="Open internal PLC and register configuration"
        aria-label="Open internal configuration center"
        onClick={() => setInternalSettingsOpen((open) => !open)}
      >
        <Settings2 size={19} />
      </button>

      {internalSettingsOpen && (
        <InternalConfigurationCenter
          definitions={registerConfiguration}
          nodes={document.nodes.filter((node) => Boolean(graphFromGeometry(node.geometry)))}
          selectedNodeId={selectedKinematicNode?.id}
          state={plcDashboard}
          connectionProfiles={connectionProfiles}
          connectionHealth={connectionHealth}
          onApply={applyRegisterDefinitions}
          onApplyConnectionProfiles={applyConnectionProfiles}
          onConnectProfile={(profile) => void connectIndustrialProfile(profile)}
          onDisconnectProfile={(profile) => void disconnectIndustrialProfile(profile)}
          onClose={() => setInternalSettingsOpen(false)}
        />
      )}

      <footer className="statusbar">
        <span>{status}</span>
        <span>{stats.fps} FPS</span>
        <span>{stats.objects} objects</span>
        <span>{stats.triangles} triangles</span>
        <span>{desktopRuntime ? 'desktop' : 'web'}</span>
        <span>{snapEnabled ? 'snap on' : 'snap off'}</span>
        <span>{autosaveAvailable ? 'autosave ready' : 'autosave pending'}</span>
        <span>{validationCounts.errors} errors</span>
        <span>{validationCounts.warnings} warnings</span>
        <span>{document.metadata.name}</span>
      </footer>

      <section className="validation-strip">
        {issues.slice(0, 4).map((issue, index) => (
          <div key={`${issue.code}-${issue.nodeId ?? 'project'}-${index}`} className={`issue ${issue.severity}`}>
            <strong>{issue.code}</strong>
            <span>{issue.message}</span>
          </div>
        ))}
      </section>
    </main>
  );
};

type InternalConfigurationCenterProps = {
  definitions: InternalRegisterDefinition[];
  nodes: SceneNode[];
  selectedNodeId?: string;
  state: PlcDashboardState;
  connectionProfiles: ConnectionProfile[];
  connectionHealth: Record<string, ConnectionHealth>;
  onApply: (definitions: InternalRegisterDefinition[]) => void;
  onApplyConnectionProfiles: (profiles: ConnectionProfile[]) => void;
  onConnectProfile: (profile: ConnectionProfile) => void;
  onDisconnectProfile: (profile: ConnectionProfile) => void;
  onClose: () => void;
};

const InternalConfigurationCenter = ({ definitions, nodes, selectedNodeId, state, connectionProfiles, connectionHealth, onApply, onApplyConnectionProfiles, onConnectProfile, onDisconnectProfile, onClose }: InternalConfigurationCenterProps) => {
  const [draftDefinitions, setDraftDefinitions] = useState<InternalRegisterDefinition[]>(definitions);
  const [draftProfiles, setDraftProfiles] = useState<ConnectionProfile[]>(connectionProfiles);
  const [editing, setEditing] = useState(false);
  const [confirmation, setConfirmation] = useState<'save' | 'discard'>();
  useEffect(() => {
    if (!editing) setDraftDefinitions((current) => JSON.stringify(current) === JSON.stringify(definitions) ? current : definitions);
  }, [definitions, editing]);
  useEffect(() => {
    if (!editing) setDraftProfiles((current) => JSON.stringify(current) === JSON.stringify(connectionProfiles) ? current : connectionProfiles);
  }, [connectionProfiles, editing]);
  const dirty = JSON.stringify(draftDefinitions) !== JSON.stringify(definitions) || JSON.stringify(draftProfiles) !== JSON.stringify(connectionProfiles);
  const updateDraft = (id: string, patch: Partial<InternalRegisterDefinition>) => setDraftDefinitions((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
  const updateProfile = (id: string, patch: Partial<ConnectionProfile>) => setDraftProfiles((current) => current.map((profile) => profile.id === id ? { ...profile, ...patch } : profile));
  const addProfile = (protocol: 'mqtt' | 'opcua') => {
    const id = `${protocol}-${Date.now()}`;
    setDraftProfiles((current) => [...current, protocol === 'mqtt'
      ? { id, name: 'MQTT Broker', protocol, endpoint: 'ws://127.0.0.1:9001', enabled: false, autoReconnect: true, reconnectDelayMs: 1500, metadata: {} }
      : { id, name: 'OPC UA Gateway', protocol, endpoint: 'http://127.0.0.1:8088', enabled: false, autoReconnect: true, reconnectDelayMs: 2000, metadata: { endpointUrl: 'opc.tcp://127.0.0.1:4840', securityPolicy: 'None' } }]);
  };
  const addDraft = () => {
    const node = nodes.find((item) => item.id === selectedNodeId);
    const graph = node ? graphFromGeometry(node.geometry) : undefined;
    const assigned = new Set(draftDefinitions.filter((entry) => entry.robotNodeId === selectedNodeId).map((entry) => entry.jointId));
    const joint = graph?.joints.find((item) => item.type !== 'fixed' && !assigned.has(item.id)) ?? graph?.joints.find((item) => item.type !== 'fixed');
    const nextWire = Math.min(65534, Math.max(99, ...draftDefinitions.map((entry) => entry.wire)) + 1);
    setDraftDefinitions((current) => [...current, { id: `custom-${Date.now()}`, wire: nextWire, semantic: joint ? `Custom control / ${joint.name}` : 'Custom holding register', encoding: 'int16-rad-x10000', access: 'read-write', enabled: true, role: joint ? 'joint' : 'custom', robotNodeId: selectedNodeId, jointId: joint?.id, connectionId: 'openplc-main', protocol: 'modbus', scale: 0.0001, offset: 0, unit: joint?.type === 'prismatic' ? 'm' : 'rad', pollingMs: 250 }]);
  };
  const restoreDraft = () => {
    const node = nodes.find((item) => item.id === selectedNodeId);
    const graph = node ? graphFromGeometry(node.geometry) : undefined;
    const joints: InternalRegisterDefinition[] = (graph?.joints.filter((joint) => joint.type !== 'fixed') ?? []).map((joint, index) => ({ id: `joint-${node!.id}-${joint.id}`, wire: 100 + index, semantic: `${node!.name} / ${joint.name}`, encoding: 'int16-rad-x10000', access: 'plc-to-platform', enabled: true, role: 'joint', robotNodeId: node!.id, jointId: joint.id }));
    setDraftDefinitions([...systemRegisterDefinitions(), ...joints]);
  };
  const jointsByNode = new Map(nodes.map((node) => [node.id, graphFromGeometry(node.geometry)?.joints.filter((joint) => joint.type !== 'fixed') ?? []]));
  const occupied = new Map<number, string[]>();
  draftDefinitions.filter((entry) => entry.enabled).forEach((entry) => {
    for (let offset = 0; offset < registerWordCount(entry.encoding); offset += 1) {
      const ids = occupied.get(entry.wire + offset) ?? [];
      occupied.set(entry.wire + offset, [...ids, entry.id]);
    }
  });
  const collisions = new Set([...occupied.values()].filter((ids) => ids.length > 1).flat());
  const enabledCount = draftDefinitions.filter((entry) => entry.enabled).length;
  const boundJointCount = draftDefinitions.filter((entry) => entry.enabled && entry.jointId).length;
  const runtimeConnections = draftProfiles.map((profile) => {
    const persistedProfile = connectionProfiles.find((item) => item.id === profile.id);
    const health = profile.protocol === 'modbus'
      ? { state: state.openPlc.online && state.openPlc.runtimeRunning !== false ? 'ONLINE' : state.openPlc.online ? 'DEGRADED' : state.openPlc.enabled ? 'CONNECTING' : 'DISCONNECTED', message: state.openPlc.runtimeIssue ?? state.openPlc.error ?? state.openPlc.diagnostics ?? 'FC03 holding registers' }
      : connectionHealth[profile.id] ?? { state: 'DISCONNECTED', message: 'Not tested' };
    return { profile, persistedProfile, health, connection: { rx: profile.protocol === 'modbus' ? state.openPlc.received : 0, detail: health.message } };
  });
  const liveValue = (entry: InternalRegisterDefinition) => {
    const register = state.frame?.physicalRegisters.find((item) => item.jointId === entry.jointId);
    if (register) return register.value.toFixed(5);
    const values: Record<string, string | number | undefined> = {
      'system-command': state.openPlc.command,
      'system-status': state.openPlc.status,
      'system-step': state.openPlc.activeStep,
      'system-time': state.openPlc.elapsedMs,
      'system-alarm': state.openPlc.alarmCode,
      'system-condition': state.openPlc.conditionState,
      'system-speed': state.openPlc.speedPermille,
      'iot-temperature': state.iotTelemetry?.hasEnvironment ? state.iotTelemetry.temperatureC : undefined,
      'iot-humidity': state.iotTelemetry?.hasEnvironment ? state.iotTelemetry.humidityPercent : undefined,
      'iot-gyro': state.iotTelemetry?.hasGyroscope ? state.iotTelemetry.gyroDps : undefined,
      'iot-age': state.iotTelemetry?.ageMs,
      'iot-valid': state.iotTelemetry?.valid ? 1 : 0,
      'iot-sequence': state.iotTelemetry?.sequence,
      'iot-policy': state.openPlc.sensorPolicy,
    };
    return values[entry.id] ?? '--';
  };

  return (
    <aside className="internal-settings-center" aria-label="Internal PLC configuration center">
      <header>
        <div><Settings2 size={17} /><span><strong>TwinAxis Signal Mapping</strong><small>TwinProperty bindings, protocol addresses and engineering transforms</small></span></div>
        <button type="button" title="Close internal configuration" aria-label="Close internal configuration" onClick={() => dirty ? setConfirmation('discard') : onClose()}><X size={17} /></button>
      </header>
      <div className="internal-settings-summary">
        <div><span>Definitions</span><strong>{draftDefinitions.length}</strong></div>
        <div><span>Enabled</span><strong>{enabledCount}</strong></div>
        <div><span>Joint bindings</span><strong>{boundJointCount}</strong></div>
        <div className={collisions.size ? 'fault' : 'healthy'}><span>Address conflicts</span><strong>{collisions.size}</strong></div>
      </div>
      <div className="internal-settings-notice">
        <Activity size={15} />
        <span><strong>{state.openPlc.online ? 'OpenPLC ONLINE' : state.running ? 'Internal PLC RUNNING' : 'Configuration mode'}</strong><small>Wire <code>%QWn</code> maps to conventional holding register <code>HR {40001}+n</code>. Changes rebuild the digital-twin bindings and persist in this browser.</small></span>
      </div>
      <div className="connection-manager" aria-label="TwinAxis Connection Manager">
        <div className="connection-manager-title"><Link2 size={14} /><span><strong>Connection Manager</strong><small>Protocol endpoints and runtime health</small></span></div>
        <div className="connection-manager-grid">
          {runtimeConnections.map(({ profile, persistedProfile, health, connection }) => <div className="connection-card connection-profile-card" key={profile.id}>
            <div><input aria-label={`${profile.name} name`} disabled={!editing} value={profile.name} onChange={(event) => updateProfile(profile.id, { name: event.target.value })} /><i className={health.state.toLowerCase()}>{health.state}</i></div>
            <span>{profile.protocol === 'opcua' ? 'OPC UA via HTTP gateway' : profile.protocol === 'mqtt' ? 'MQTT over WebSocket' : 'Modbus TCP'}</span>
            <input aria-label={`${profile.name} endpoint`} disabled={!editing || profile.protocol === 'modbus'} value={profile.protocol === 'modbus' ? `${state.openPlc.host}:${state.openPlc.port}` : profile.endpoint} onChange={(event) => updateProfile(profile.id, { endpoint: event.target.value })} />
            <small>RX {connection.rx} · {connection.detail}</small>
            {profile.protocol === 'opcua' && <input aria-label="OPC UA server endpoint" disabled={!editing} value={String(profile.metadata.endpointUrl ?? '')} onChange={(event) => updateProfile(profile.id, { metadata: { ...profile.metadata, endpointUrl: event.target.value } })} />}
            <div className="connection-profile-actions">
              <label><input type="checkbox" disabled={!editing} checked={profile.enabled} onChange={(event) => updateProfile(profile.id, { enabled: event.target.checked })} />Enabled</label>
              {profile.protocol !== 'modbus' && <button type="button" disabled={dirty || !persistedProfile?.enabled} onClick={() => persistedProfile && (health.state === 'ONLINE' ? onDisconnectProfile(persistedProfile) : onConnectProfile(persistedProfile))}>{health.state === 'ONLINE' ? 'Disconnect' : 'Test connection'}</button>}
              {editing && profile.protocol !== 'modbus' && <button type="button" className="icon danger" title="Remove connection profile" onClick={() => setDraftProfiles((current) => current.filter((item) => item.id !== profile.id))}><Trash2 size={13} /></button>}
            </div>
          </div>)}
        </div>
      </div>
      <div className="internal-register-toolbar">
        <button type="button" className={`configuration-edit-toggle ${editing ? 'editing' : ''}`} onClick={() => { setEditing((active) => !active); if (editing && dirty) setConfirmation('discard'); }}><Unlock size={14} />{editing ? 'Editing enabled' : 'Enable editing'}</button>
        <button type="button" disabled={!editing} onClick={addDraft}><Link2 size={14} />Add register</button>
        <button type="button" disabled={!editing} onClick={() => addProfile('mqtt')}>Add MQTT</button>
        <button type="button" disabled={!editing} onClick={() => addProfile('opcua')}>Add OPC UA</button>
        <button type="button" disabled={!editing} onClick={restoreDraft}><RotateCw size={14} />Restore documented map</button>
        <button type="button" className="save-configuration" disabled={!editing || !dirty || collisions.size > 0} onClick={() => setConfirmation('save')}><Save size={14} />Save changes</button>
        <button type="button" disabled={!editing || !dirty} onClick={() => setConfirmation('discard')}><X size={14} />Cancel changes</button>
        <span>{selectedNodeId ? `Active robot: ${nodes.find((node) => node.id === selectedNodeId)?.name ?? selectedNodeId}` : 'Select a robot to bind new joints'}</span>
      </div>
      <div className="internal-register-table">
        <div className="internal-register-head"><span>On</span><span>Wire / HR</span><span>Semantic</span><span>Encoding</span><span>Direction</span><span>Robot / joint</span><span>Live</span><span></span></div>
        {draftDefinitions.map((entry) => {
          const entryJoints = entry.robotNodeId ? jointsByNode.get(entry.robotNodeId) ?? [] : [];
          const conflict = collisions.has(entry.id);
          return (
            <div className={`internal-register-row ${conflict ? 'conflict' : ''}`} key={entry.id}>
              <label className="internal-enabled"><input type="checkbox" disabled={!editing} checked={entry.enabled} onChange={(event) => updateDraft(entry.id, { enabled: event.target.checked })} /><span>{entry.enabled ? 'ON' : 'OFF'}</span></label>
              <label><span>Wire</span><div className="wire-input"><b>%QW</b><input type="number" disabled={!editing} min="0" max="65534" value={entry.wire} onChange={(event) => updateDraft(entry.id, { wire: Math.max(0, Math.min(65534, Number(event.target.value))) })} /></div><code>HR {registerHr(entry.wire)}{registerWordCount(entry.encoding) > 1 ? `..${registerHr(entry.wire + 1)}` : ''}</code></label>
              <label><span>Semantic</span><input disabled={!editing} value={entry.semantic} onChange={(event) => updateDraft(entry.id, { semantic: event.target.value })} /></label>
              <label><span>Encoding</span><select disabled={!editing} value={entry.encoding} onChange={(event) => updateDraft(entry.id, { encoding: event.target.value as RegisterEncoding })}><option value="uint16">UINT16</option><option value="int16">INT16</option><option value="int16-rad-x10000">INT16 rad x10000</option><option value="float32-be">FLOAT32 BE</option></select></label>
              <label><span>Direction</span><select disabled={!editing} value={entry.access} onChange={(event) => updateDraft(entry.id, { access: event.target.value as RegisterAccess })}><option value="platform-to-plc">Platform to PLC</option><option value="plc-to-platform">PLC to platform</option><option value="read-write">Read / write</option></select></label>
              <label className="binding-fields"><span>Robot / joint</span><select disabled={!editing} value={entry.robotNodeId ?? ''} onChange={(event) => { const nodeId = event.target.value || undefined; const joint = nodeId ? jointsByNode.get(nodeId)?.[0] : undefined; updateDraft(entry.id, { robotNodeId: nodeId, jointId: joint?.id, role: joint ? 'joint' : entry.role }); }}><option value="">System / unbound</option>{nodes.map((node) => <option value={node.id} key={node.id}>{node.name}</option>)}</select><select value={entry.jointId ?? ''} disabled={!editing || !entry.robotNodeId} onChange={(event) => updateDraft(entry.id, { jointId: event.target.value || undefined, role: event.target.value ? 'joint' : entry.role })}><option value="">No joint</option>{entryJoints.map((joint) => <option value={joint.id} key={joint.id}>{joint.name} · {joint.type}</option>)}</select></label>
              <div className="internal-live-value"><span>Current</span><strong>{liveValue(entry)}</strong><small>{state.openPlc.online ? 'OpenPLC' : state.running ? 'Internal PLC' : 'last value'}</small></div>
              <button type="button" className="icon danger" title={entry.role === 'system' ? 'System definitions cannot be removed; disable them instead' : 'Delete register definition'} disabled={!editing || entry.role === 'system'} onClick={() => setDraftDefinitions((current) => current.filter((item) => item.id !== entry.id))}><Trash2 size={14} /></button>
              <div className="mapping-fields">
                <label><span>Connection</span><input disabled={!editing} value={entry.connectionId ?? 'openplc-main'} onChange={(event) => updateDraft(entry.id, { connectionId: event.target.value })} /></label>
                <label><span>Protocol</span><select disabled={!editing} value={entry.protocol ?? 'modbus'} onChange={(event) => updateDraft(entry.id, { protocol: event.target.value as 'modbus' | 'mqtt' | 'opcua', connectionId: event.target.value === 'mqtt' ? 'mqtt-main' : event.target.value === 'opcua' ? 'opcua-main' : 'openplc-main' })}><option value="modbus">Modbus TCP</option><option value="mqtt">MQTT</option><option value="opcua">OPC UA</option></select></label>
                <label><span>Scale</span><input type="number" step="any" disabled={!editing} value={mappingScale(entry)} onChange={(event) => updateDraft(entry.id, { scale: Number(event.target.value) })} /></label>
                <label><span>Offset</span><input type="number" step="any" disabled={!editing} value={mappingOffset(entry)} onChange={(event) => updateDraft(entry.id, { offset: Number(event.target.value) })} /></label>
                <label><span>Engineering unit</span><input disabled={!editing} value={entry.unit ?? (entry.encoding === 'int16-rad-x10000' ? 'rad' : '')} onChange={(event) => updateDraft(entry.id, { unit: event.target.value })} /></label>
                <label><span>Polling (ms)</span><input type="number" min="20" max="60000" disabled={!editing} value={mappingPollingMs(entry)} onChange={(event) => updateDraft(entry.id, { pollingMs: Math.max(20, Number(event.target.value)) })} /></label>
                {entry.protocol === 'mqtt' && <><label><span>MQTT topic</span><input disabled={!editing} value={entry.topic ?? `twinaxis/${entry.robotNodeId ?? 'asset'}/${entry.jointId ?? entry.id}`} onChange={(event) => updateDraft(entry.id, { topic: event.target.value })} /></label><label><span>JSON value path</span><input disabled={!editing} placeholder="value" value={entry.valuePath ?? ''} onChange={(event) => updateDraft(entry.id, { valuePath: event.target.value })} /></label><label><span>QoS</span><select disabled={!editing} value={entry.qos ?? 0} onChange={(event) => updateDraft(entry.id, { qos: Number(event.target.value) as 0 | 1 | 2 })}><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label></>}
                {entry.protocol === 'opcua' && <><label><span>OPC UA NodeId</span><input disabled={!editing} placeholder="ns=2;s=Robot.J1" value={entry.opcUaNodeId ?? ''} onChange={(event) => updateDraft(entry.id, { opcUaNodeId: event.target.value })} /></label><label><span>Browse path</span><input disabled={!editing} placeholder="Objects/Robot/J1" value={entry.opcUaBrowsePath ?? ''} onChange={(event) => updateDraft(entry.id, { opcUaBrowsePath: event.target.value })} /></label></>}
              </div>
              {conflict && <div className="register-conflict-message"><AlertTriangle size={13} />Register range overlaps another enabled definition.</div>}
            </div>
          );
        })}
      </div>
      <footer><ShieldCheck size={14} /><span>{editing ? 'EDIT MODE: changes are temporary until Save changes is confirmed.' : 'READ ONLY: enable editing before changing sensitive PLC variables.'} The physical OpenPLC program must expose every configured `%QW` address.</span></footer>
      {confirmation && <div className="configuration-confirmation" role="dialog" aria-modal="true" aria-label={confirmation === 'save' ? 'Confirm sensitive configuration changes' : 'Discard configuration changes'}><div><AlertTriangle size={22} /><h3>{confirmation === 'save' ? 'Apply sensitive PLC configuration?' : 'Discard unconfirmed changes?'}</h3><p>{confirmation === 'save' ? 'This will stop local motion, replace the active signal map and connection profiles, rebuild digital-twin bindings and persist the configuration in this browser.' : 'The current draft has not been saved. Discarding restores the last confirmed configuration.'}</p><div><button type="button" onClick={() => setConfirmation(undefined)}>Go back</button><button type="button" className={confirmation === 'save' ? 'confirm-save' : 'danger'} onClick={() => { if (confirmation === 'save') { onApply(draftDefinitions); onApplyConnectionProfiles(draftProfiles); setEditing(false); } else { setDraftDefinitions(definitions); setDraftProfiles(connectionProfiles); setEditing(false); } setConfirmation(undefined); if (confirmation === 'discard' && dirty) onClose(); }}>{confirmation === 'save' ? 'Confirm and save' : 'Discard changes'}</button></div></div></div>}
    </aside>
  );
};

type VectorEditorProps = {
  label: string;
  values: [number, number, number];
  step?: number;
  onChange: (index: number, value: number) => void;
};

const VectorEditor = ({ label, values, step = 0.1, onChange }: VectorEditorProps) => (
  <div className="vector-editor">
    <span>{label}</span>
    {values.map((value, index) => (
      <input
        key={index}
        type="number"
        value={Number(value.toFixed(3))}
        step={step}
        onChange={(event) => onChange(index, Number(event.target.value))}
      />
    ))}
  </div>
);

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
};

const Slider = ({ label, value, min, max, step, onChange }: SliderProps) => (
  <label className="slider-row">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    <strong>{value.toFixed(2)}</strong>
  </label>
);

const formatVector = (values: number[] | undefined, digits = 3) => (values?.map((value) => Number(value).toFixed(digits)).join(', ') ?? 'n/a');

type PlcModbusDashboardProps = {
  node?: SceneNode;
  state: PlcDashboardState;
  onStart: () => void;
  onStop: () => void;
  onStep: () => void;
  onToggleAdvanced: () => void;
  onToggleTerminalBridge: () => void;
  onDisconnectTerminalBridge: () => void;
  onEndpointChange: (field: 'host' | 'port', value: string) => void;
  onWriteRegister: (signalId: string, value: number) => void;
  onPlcInputChange: <K extends keyof VirtualPlcInputs>(key: K, value: VirtualPlcInputs[K]) => void;
  onPlcFaultReset: () => void;
  onPlcScanTargetChange: (targetMs: number) => void;
  onToggleOpenPlc: () => void;
  onProbeOpenPlc: () => void;
  onTestPhysicalPlcConnection: () => Promise<void>;
  onTestPhysicalPlcReaction: () => Promise<void>;
  onTestPhysicalPlcJog: (direction: 'forward' | 'return') => Promise<void>;
  physicalPlcDemoActive: boolean;
  onTogglePhysicalPlcDemo: () => Promise<void>;
  onOpenPlcCommand: (command: 0 | 1 | 2) => void;
  onActivateLocalManual: () => void;
  onOpenPlcSensorPolicy: (policy: 0 | 1) => void;
  onOpenPlcConfigChange: (field: 'endpointProfile' | 'host' | 'port' | 'unitId' | 'address' | 'pollMs' | 'dataFormat' | 'autoReconnect', value: string | number | boolean) => void;
  historianRecording: boolean;
  historianRecordCount: number;
  onToggleHistorianRecording: () => void;
  onClose: () => void;
};

const decodeOpenPlcFloat32 = (highWord: number, lowWord: number) => {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint16(0, highWord, false);
  view.setUint16(2, lowWord, false);
  return view.getFloat32(0, false);
};

const decodeOpenPlcInt16 = (word: number) => (word & 0x8000 ? word - 0x10000 : word);

const encodeOpenPlcInt16 = (value: number) => Math.round(Math.max(-32768, Math.min(32767, value))) & 0xffff;

const encodeOpenPlcFloat32 = (value: number) => {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value, false);
  return [view.getUint16(0, false), view.getUint16(2, false)];
};

const clampPlcValue = (value: number, min = -3.14, max = 3.14) => Math.max(min, Math.min(max, value));

const registerValueLimits = (register: PlcRegister) => {
  const lowerName = register.jointName.toLowerCase();
  if (lowerName.includes('pinza') || lowerName.includes('gripper') || lowerName.includes('finger')) return { min: 0, max: 1 };
  if (lowerName.includes('linear') || lowerName.includes('rail') || lowerName.includes('conveyor')) return { min: -1, max: 1 };
  return { min: -3.14, max: 3.14 };
};

const formatHexPair = (values: number[]) => values.map((value) => `0x${value.toString(16).padStart(4, '0').toUpperCase()}`).join(' ');

const buildPlcMirrorDocument = (node: SceneNode | undefined, rows: PlcRegister[], name: string): AssetDocument | undefined => {
  if (!node || !('kinematicGraph' in node.geometry) || !node.geometry.kinematicGraph) return undefined;
  const graph = node.geometry.kinematicGraph;
  const baseState = node.geometry.kinematicState ?? createHomeKinematicState(graph);
  const rowValues = Object.fromEntries(rows.map((row) => [row.jointId, row.value]));
  const mirrorNode: SceneNode = {
    ...node,
    id: `${node.id}-${name}`,
    name,
    transform: {
      position: [0, 0, 0],
      rotation: node.transform.rotation,
      scale: node.transform.scale,
    },
    geometry: {
      ...node.geometry,
      kinematicGraph: graph,
      kinematicState: {
        homeJointValues: { ...baseState.homeJointValues },
        jointValues: { ...baseState.homeJointValues, ...baseState.jointValues, ...rowValues },
      },
    },
  };
  return {
    schemaVersion: 1,
    metadata: {
      id: `${node.id}-${name}-plc-mirror`,
      name,
      author: 'local-simulator',
      createdAt: node.createdAt,
      updatedAt: new Date().toISOString(),
    },
    nodes: [mirrorNode],
    selectedNodeId: mirrorNode.id,
  };
};

const PlcRobotMirror = ({
  node,
  title,
  subtitle,
  rows,
  editable,
  running,
  onWriteRegister,
}: {
  node?: SceneNode;
  title: string;
  subtitle: string;
  rows: PlcRegister[];
  editable?: boolean;
  running?: boolean;
  onWriteRegister?: (signalId: string, value: number) => void;
}) => {
  const mirrorDocument = useMemo(() => buildPlcMirrorDocument(node, rows, title), [node, rows, title]);
  const noop = useCallback(() => undefined, []);
  const noopTransform = useCallback(() => undefined, []);
  const noopPartTransforms = useCallback(() => undefined, []);
  const noopJointPose = useCallback(() => undefined, []);
  const noopKinematicPoint = useCallback(() => undefined, []);
  const noopKinematicAxis = useCallback(() => undefined, []);
  const noopRobotGuide = useCallback(() => undefined, []);
  const noopPieceCenter = useCallback(() => undefined, []);
  const noopPartSelection = useCallback(() => undefined, []);
  const noopStats = useCallback(() => undefined, []);

  return (
    <section className="plc-robot-screen">
      <div className="plc-screen-head">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span className={running ? 'plc-live-pill' : 'plc-idle-pill'}>{running ? 'LIVE' : 'HOLD'}</span>
      </div>
      <div className="plc-robot-view" aria-label={`${title} robot mirror`}>
        {mirrorDocument ? (
          <ThreeViewport
            document={mirrorDocument}
            tool="select"
            partEditMode="free"
            snapEnabled={false}
            onSelect={noop}
            onTransformCommit={noopTransform}
            onImportedPartTransformsCommit={noopPartTransforms}
            onJointPoseChange={noopJointPose}
            onKinematicPointPick={noopKinematicPoint}
            onKinematicAxisChange={noopKinematicAxis}
            onRobotCursorGuide={noopRobotGuide}
            onPieceReferenceCenterEstimate={noopPieceCenter}
            onPartSelectionChange={noopPartSelection}
            onStatsChange={noopStats}
          />
        ) : (
          <div className="empty-state compact">Select a robot with KinematicGraph to render the real 3D mirror.</div>
        )}
        <div className="plc-mini-registers">
          {rows.slice(0, 6).map((register) => {
            const limits = registerValueLimits(register);
            const value = clampPlcValue(register.value, limits.min, limits.max);
            return (
              <label key={`${title}-${register.signalId}`} className="plc-register-control">
                <span title={register.jointName}>{register.jointName}</span>
                <input
                  type="range"
                  min={limits.min}
                  max={limits.max}
                  step="0.01"
                  value={value}
                  disabled={!editable}
                  onChange={(event) => onWriteRegister?.(register.signalId, Number(event.target.value))}
                />
                <strong>{value.toFixed(2)}</strong>
              </label>
            );
          })}
          {!rows.length && <div className="empty-state compact">Run or Step to create live Modbus registers.</div>}
        </div>
      </div>
    </section>
  );
};

type TraceAuditLayer = 'flow' | 'modbus' | 'plc' | 'scene';

type TraceAuditSample = {
  sequence: number;
  capturedAt: number;
  sampleId: string;
  gyroDps: number;
  sensorAgeMs: number;
  conditionState: number;
  alarmCode: number;
  speedPermille: number;
  joints: number[];
};

const TracePipeline3D = ({ live, gyroDps, conditionState, height }: { live: boolean; gyroDps: number; conditionState: number; height: number }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef({ live, gyroDps, conditionState });
  runtimeRef.current = { live, gyroDps, conditionState };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101619);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 5.8, 14.2);
    camera.lookAt(0, 0.9, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.prepend(renderer.domElement);

    const materials = {
      dark: new THREE.MeshStandardMaterial({ color: 0x252d31, roughness: 0.62, metalness: 0.42 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0c1012, roughness: 0.48, metalness: 0.55 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x9aa7ad, roughness: 0.28, metalness: 0.78 }),
      white: new THREE.MeshStandardMaterial({ color: 0xd8dfe1, roughness: 0.42, metalness: 0.28 }),
      orange: new THREE.MeshStandardMaterial({ color: 0xe85e12, roughness: 0.38, metalness: 0.25 }),
      pcb: new THREE.MeshStandardMaterial({ color: 0x176b48, roughness: 0.55, metalness: 0.18 }),
      green: new THREE.MeshBasicMaterial({ color: 0x43ed86 }),
      yellow: new THREE.MeshBasicMaterial({ color: 0xffc247 }),
      cyan: new THREE.MeshStandardMaterial({ color: 0x58e0d5, emissive: 0x123f40, transparent: true, opacity: 0.68, roughness: 0.25, metalness: 0.25, wireframe: true }),
      cyanSolid: new THREE.MeshBasicMaterial({ color: 0x55d6ca, transparent: true, opacity: 0.18 }),
      red: new THREE.MeshBasicMaterial({ color: 0xef5350 }),
    };
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
    const sphere = new THREE.SphereGeometry(0.5, 12, 8);
    const torus = new THREE.TorusGeometry(0.5, 0.09, 8, 18);
    const stationX = [-4.8, -1.7, 1.7, 4.8];

    scene.add(new THREE.HemisphereLight(0xd8f2f4, 0x182025, 1.55));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
    keyLight.position.set(-4, 8, 7);
    scene.add(keyLight);

    const addPart = (parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, scale: [number, number, number], position: [number, number, number], rotation: [number, number, number] = [0, 0, 0]) => {
      const part = new THREE.Mesh(geometry, material);
      part.scale.set(...scale); part.position.set(...position); part.rotation.set(...rotation); parent.add(part);
      return part;
    };

    const addStation = (x: number, color: THREE.Material) => {
      const pad = addPart(scene, cylinder, materials.dark, [1.25, 0.12, 1.25], [x, 0.03, 0]);
      addPart(scene, torus, color, [1.82, 1.82, 1.82], [x, 0.12, 0], [Math.PI / 2, 0, 0]);
      return pad;
    };

    const sensor = new THREE.Group();
    addPart(sensor, box, materials.dark, [1.25, 0.18, 0.78], [0, 0, 0]);
    addPart(sensor, box, materials.pcb, [1.08, 0.08, 0.63], [0, 0.14, 0]);
    addPart(sensor, box, materials.orange, [1.25, 0.12, 0.16], [0, 0.23, -0.31]);
    addPart(sensor, box, materials.black, [0.28, 0.08, 0.28], [-0.08, 0.23, 0.02]);
    addPart(sensor, cylinder, materials.metal, [0.22, 0.05, 0.22], [0.38, 0.23, 0.02]);
    addPart(sensor, cylinder, materials.yellow, [0.09, 0.07, 0.09], [-0.43, 0.23, 0.18]);
    addPart(sensor, cylinder, materials.green, [0.07, 0.07, 0.07], [-0.25, 0.23, 0.18]);
    addPart(sensor, box, materials.metal, [0.38, 0.09, 0.25], [0.31, 0.23, -0.08]);
    addPart(sensor, cylinder, materials.metal, [0.035, 0.55, 0.035], [0.54, 0.57, -0.16]);
    addPart(sensor, sphere, materials.orange, [0.09, 0.09, 0.09], [0.54, 0.88, -0.16]);
    sensor.position.set(stationX[0], 0.62, 0); sensor.rotation.y = -0.18; scene.add(sensor);
    addStation(stationX[0], materials.orange);

    const plc = new THREE.Group();
    addPart(plc, box, materials.metal, [1.72, 0.1, 0.12], [0, -0.61, -0.1]);
    addPart(plc, box, materials.dark, [1.78, 1.25, 0.18], [0, 0, -0.36]);
    for (let index = 0; index < 6; index += 1) {
      const x = -0.68 + index * 0.275;
      addPart(plc, box, index === 0 ? materials.orange : materials.white, [0.24, 1.02, 0.48], [x, 0, -0.02]);
      addPart(plc, box, materials.black, [0.13, 0.2, 0.035], [x, -0.19, 0.24]);
      addPart(plc, sphere, index < 2 ? materials.green : materials.yellow, [0.045, 0.045, 0.045], [x, 0.34, 0.25]);
      for (let terminal = 0; terminal < 3; terminal += 1) {
        addPart(plc, box, materials.dark, [0.045, 0.055, 0.04], [x - 0.07 + terminal * 0.07, 0.54, 0.25]);
        addPart(plc, box, materials.dark, [0.045, 0.055, 0.04], [x - 0.07 + terminal * 0.07, -0.54, 0.25]);
      }
    }
    plc.position.set(stationX[1], 0.78, 0); plc.rotation.y = 0.08; scene.add(plc);
    addStation(stationX[1], materials.green);

    const createArm = (bodyMaterial: THREE.Material, jointMaterial: THREE.Material, hologram = false) => {
      const group = new THREE.Group();
      addPart(group, cylinder, materials.black, [0.84, 0.16, 0.84], [0, 0.13, 0]);
      addPart(group, cylinder, bodyMaterial, [0.68, 0.38, 0.68], [0, 0.36, 0]);
      const j1 = new THREE.Group(); j1.position.y = 0.58; group.add(j1);
      addPart(j1, cylinder, jointMaterial, [0.54, 0.28, 0.54], [0, 0, 0]);
      addPart(j1, torus, bodyMaterial, [1.02, 1.02, 1.02], [0, 0.14, 0], [Math.PI / 2, 0, 0]);
      const shoulder = new THREE.Group(); shoulder.position.set(0, 0.18, 0); j1.add(shoulder);
      addPart(shoulder, cylinder, jointMaterial, [0.5, 0.58, 0.5], [0, 0, 0], [Math.PI / 2, 0, 0]);
      addPart(shoulder, box, bodyMaterial, [0.43, 1.18, 0.46], [0.18, 0.72, 0], [0, 0, -0.2]);
      const elbow = new THREE.Group(); elbow.position.set(0.41, 1.4, 0); shoulder.add(elbow);
      addPart(elbow, cylinder, jointMaterial, [0.45, 0.54, 0.45], [0, 0, 0], [Math.PI / 2, 0, 0]);
      addPart(elbow, box, bodyMaterial, [0.38, 1.02, 0.4], [0.24, 0.62, 0], [0, 0, -0.27]);
      const wrist1 = new THREE.Group(); wrist1.position.set(0.52, 1.18, 0); elbow.add(wrist1);
      addPart(wrist1, cylinder, jointMaterial, [0.38, 0.48, 0.38], [0, 0, 0], [Math.PI / 2, 0, 0]);
      const wrist2 = new THREE.Group(); wrist2.position.set(0.43, 0.18, 0); wrist1.add(wrist2);
      addPart(wrist2, cylinder, bodyMaterial, [0.32, 0.62, 0.32], [0.28, 0, 0], [0, 0, Math.PI / 2]);
      const wrist3 = new THREE.Group(); wrist3.position.set(0.61, 0, 0); wrist2.add(wrist3);
      addPart(wrist3, cylinder, jointMaterial, [0.28, 0.28, 0.28], [0, 0, 0], [0, 0, Math.PI / 2]);
      addPart(wrist3, cylinder, materials.black, [0.22, 0.14, 0.22], [0.22, 0, 0], [0, 0, Math.PI / 2]);
      addPart(wrist3, box, bodyMaterial, [0.32, 0.12, 0.46], [0.38, 0, 0]);
      addPart(wrist3, box, jointMaterial, [0.08, 0.42, 0.11], [0.52, 0.22, 0.14]);
      addPart(wrist3, box, jointMaterial, [0.08, 0.42, 0.11], [0.52, 0.22, -0.14]);
      if (hologram) {
        addPart(group, torus, materials.cyanSolid, [1.75, 1.75, 1.75], [0, 0.09, 0], [Math.PI / 2, 0, 0]);
        addPart(group, torus, materials.cyanSolid, [2.15, 2.15, 2.15], [0, 0.08, 0], [Math.PI / 2, 0, 0]);
      }
      group.userData.j1 = j1; group.userData.shoulder = shoulder; group.userData.elbow = elbow;
      group.userData.wrist1 = wrist1; group.userData.wrist2 = wrist2; group.userData.wrist3 = wrist3;
      return group;
    };
    const physicalArm = createArm(materials.orange, materials.metal); physicalArm.position.set(stationX[2], 0.1, 0); physicalArm.scale.setScalar(0.82); scene.add(physicalArm);
    const twinArm = createArm(materials.cyan, materials.cyan, true); twinArm.position.set(stationX[3], 0.1, 0); twinArm.scale.setScalar(0.82); scene.add(twinArm);
    addStation(stationX[2], materials.orange);
    addStation(stationX[3], materials.cyanSolid);

    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x547078 });
    for (let index = 0; index < stationX.length - 1; index += 1) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(stationX[index] + 0.72, 0.35, 0.55), new THREE.Vector3(stationX[index + 1] - 0.72, 0.35, 0.55)]);
      scene.add(new THREE.Line(geometry, lineMaterial));
    }
    const packetMaterial = new THREE.MeshBasicMaterial({ color: live ? 0x55d6ca : 0x667178 });
    const packets = [0, 1, 2].map(() => { const packet = new THREE.Mesh(sphere, packetMaterial); packet.scale.setScalar(0.13); packet.position.set(0, 0.35, 0.55); scene.add(packet); return packet; });
    const grid = new THREE.GridHelper(13, 26, 0x344047, 0x222a2f); grid.position.y = -0.02; scene.add(grid);

    let visible = true;
    let animationFrame = 0;
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(host);
    const resize = () => {
      const width = Math.max(1, host.clientWidth); const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(host); resize();
    const startedAt = performance.now();
    const animate = (now: number) => {
      animationFrame = requestAnimationFrame(animate);
      if (!visible || document.hidden) return;
      const time = (now - startedAt) / 1000;
      const runtime = runtimeRef.current;
      const amplitude = runtime.conditionState < 2 ? Math.min(0.45, Math.max(0.06, runtime.gyroDps / 500)) : 0;
      const shoulderAngle = Math.sin(time * 1.25) * amplitude;
      const elbowAngle = Math.sin(time * 1.7 + 0.8) * amplitude * 1.25;
      for (const arm of [physicalArm, twinArm]) {
        arm.userData.j1.rotation.y = Math.sin(time * 0.65) * amplitude * 0.55;
        arm.userData.shoulder.rotation.z = shoulderAngle;
        arm.userData.elbow.rotation.z = elbowAngle;
        arm.userData.wrist1.rotation.y = Math.sin(time * 1.4) * amplitude * 0.7;
        arm.userData.wrist2.rotation.z = Math.sin(time * 1.1 + 1.3) * amplitude * 0.65;
        arm.userData.wrist3.rotation.x = Math.sin(time * 1.8) * amplitude;
      }
      packets.forEach((packet, index) => {
        packetMaterial.color.setHex(runtime.live ? 0x55d6ca : 0x667178);
        const segmentProgress = runtime.live ? (time * 0.48 + index * 0.33) % 1 : 0.5;
        packet.position.x = THREE.MathUtils.lerp(stationX[index] + 0.75, stationX[index + 1] - 0.75, segmentProgress);
      });
      renderer.render(scene, camera);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(animationFrame); observer.disconnect(); resizeObserver.disconnect();
      scene.traverse((object) => { if (object instanceof THREE.Mesh || object instanceof THREE.Line) object.geometry.dispose(); });
      Object.values(materials).forEach((material) => material.dispose()); lineMaterial.dispose(); packetMaterial.dispose();
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  return <div className="trace-pipeline-3d" ref={hostRef} style={{ height }}><div className="trace-pipeline-labels"><span>IoT Sensor</span><span>OpenPLC</span><span>Robot</span><span>Digital Twin</span></div></div>;
};

const TraceAuditDashboard = ({ node, state, onClose }: { node?: SceneNode; state: PlcDashboardState; onClose: () => void }) => {
  const [layer, setLayer] = useState<TraceAuditLayer>('flow');
  const [history, setHistory] = useState<TraceAuditSample[]>([]);
  const [pipelineHeight, setPipelineHeight] = useState(280);
  const [sceneHeight, setSceneHeight] = useState(420);
  const verticalResizeRef = useRef<{ kind: 'pipeline' | 'scene'; pointerId: number; startY: number; startHeight: number }>();
  const telemetry = state.iotTelemetry;
  const registers = state.frame?.physicalRegisters ?? [];
  const twinState = state.frame?.digitalTwinState ?? [];
  const packets = state.frame?.modbusPackets ?? [];
  const conditionState = state.openPlc.conditionState ?? 3;
  const alarmCode = state.openPlc.alarmCode ?? 0;
  const speedPermille = state.openPlc.speedPermille ?? 0;
  const conditionLabels = ['NORMAL', 'WARNING', 'TRIP / HOLD', 'STALE / HOLD'];
  const conditionLabel = conditionLabels[conditionState] ?? 'UNKNOWN';
  const gyroDps = telemetry?.valid && telemetry.hasGyroscope ? telemetry.gyroDps : 0;
  const motionPermit = state.openPlc.sensorPolicy === 1;
  const sensorMoving = gyroDps >= 3;
  const chainLive = Boolean(telemetry?.valid && state.externalBridgeServerOnline && state.openPlc.online && state.openPlc.runtimeRunning !== false);

  useEffect(() => {
    if (!telemetry?.sequence || !state.frame) return;
    const next: TraceAuditSample = {
      sequence: telemetry.sequence,
      capturedAt: Date.now(),
      sampleId: telemetry.sampleId ?? '',
      gyroDps,
      sensorAgeMs: telemetry.ageMs,
      conditionState,
      alarmCode,
      speedPermille,
      joints: registers.slice(0, 6).map((register) => register.value),
    };
    setHistory((current) => current[current.length - 1]?.sequence === next.sequence ? current : [...current.slice(-119), next]);
  }, [telemetry?.sequence]);

  const twinRows: PlcRegister[] = twinState.map((item, index) => {
    const source = registers.find((register) => register.jointId === item.jointId);
    return {
      address: source?.address ?? index,
      displayAddress: item.modbusAddress || source?.displayAddress || String(40101 + index),
      signalId: source?.signalId ?? item.signalPath,
      jointId: item.jointId,
      jointName: item.jointName,
      value: item.value,
      registers: source?.registers ?? [],
    };
  });
  const gyroPeak = history.length ? Math.max(...history.map((sample) => sample.gyroDps)) : gyroDps;
  const jointChanges = history.reduce((count, sample, index) => {
    if (!index) return count;
    return count + (sample.joints.some((value, joint) => Math.abs(value - (history[index - 1].joints[joint] ?? value)) > 0.0001) ? 1 : 0);
  }, 0);
  const latestPacket = packets[packets.length - 1];
  const qualityBits = (telemetry?.valid ? 1 : 0) | ((telemetry?.ageMs ?? 65535) < 1000 ? 2 : 0) | (telemetry?.source ? 4 : 0) | (telemetry?.hasAcceleration ? 8 : 0) | (telemetry?.hasGyroscope ? 16 : 0) | (telemetry?.hasEnvironment ? 32 : 0) | (telemetry?.hasMagnetometer ? 64 : 0);
  const wireRows = [
    { wire: '%QW90', hr: '40091', semantic: 'Command', encoding: '0 Manual/Hold, 1 Auto, 2 Home', value: state.openPlc.command },
    { wire: '%QW91..93', hr: '40092..40094', semantic: 'Status, step, elapsed time', encoding: 'UINT16', value: `${state.openPlc.status ?? '--'}, ${state.openPlc.activeStep ?? '--'}, ${state.openPlc.elapsedMs ?? '--'} ms` },
    { wire: '%QW94..96', hr: '40095..40097', semantic: 'AlarmCode, ConditionState, SpeedPermille', encoding: 'UINT16', value: `${alarmCode}, ${conditionState}, ${speedPermille}` },
    { wire: '%QW100..105', hr: '40101..40106', semantic: 'J1..J6', encoding: 'INT16, rad x10000', value: registers.slice(0, 6).map((register) => register.value.toFixed(3)).join(', ') || '--' },
    { wire: '%QW120', hr: '40121', semantic: 'Temperature', encoding: 'INT16, Celsius x100', value: telemetry?.hasEnvironment ? `${telemetry.temperatureC.toFixed(2)} C` : '--' },
    { wire: '%QW121', hr: '40122', semantic: 'Relative humidity', encoding: 'UINT16, %RH x100', value: telemetry?.hasEnvironment ? `${telemetry.humidityPercent.toFixed(2)} %RH` : '--' },
    { wire: '%QW122', hr: '40123', semantic: 'Gyroscope magnitude', encoding: 'UINT16, deg/s x100', value: `${fixedTrace(gyroDps)} deg/s` },
    { wire: '%QW123..126', hr: '40124..40127', semantic: 'Age, valid, sequence, quality bits', encoding: 'UINT16', value: `${telemetry?.ageMs ?? '--'} ms, ${telemetry?.valid ? 1 : 0}, ${telemetry?.sequence ?? '--'}, ${qualityBits}` },
    { wire: '%QW127', hr: '40128', semantic: 'SensorPolicy', encoding: '0 condition monitor, 1 motion permit', value: state.openPlc.sensorPolicy ?? '--' },
  ];

  return (
    <div className="trace-audit-shell">
      <header className="trace-audit-head">
        <div>
          <strong>Deep Movement Traceability</strong>
          <span>{node?.name ?? 'No kinematic robot selected'} · {chainLive ? 'end-to-end live' : 'partial telemetry'}</span>
        </div>
        <div className="trace-audit-head-status">
          <i className={chainLive ? 'online' : 'offline'} />
          <code>{telemetry?.sampleId || 'no sample'}</code>
          <button type="button" title="Close traceability audit" aria-label="Close traceability audit" onClick={onClose}><ChevronRight size={18} /></button>
        </div>
      </header>

      <nav className="trace-layer-tabs" aria-label="Traceability layers">
        <button className={layer === 'flow' ? 'active' : ''} onClick={() => setLayer('flow')}><Activity size={14} />Flow</button>
        <button className={layer === 'modbus' ? 'active' : ''} onClick={() => setLayer('modbus')}><Link2 size={14} />Modbus</button>
        <button className={layer === 'plc' ? 'active' : ''} onClick={() => setLayer('plc')}><Settings2 size={14} />PLC</button>
        <button className={layer === 'scene' ? 'active' : ''} onClick={() => setLayer('scene')}><Cuboid size={14} />3D chain</button>
      </nav>

      <div className="trace-audit-body">
        {layer === 'flow' && (
          <>
            <TracePipeline3D live={chainLive} gyroDps={gyroDps} conditionState={conditionState} height={pipelineHeight} />
            <div
              className="trace-height-resize-handle"
              role="separator"
              aria-label="Resize audit pipeline 3D scene height"
              aria-orientation="horizontal"
              onPointerDown={(event) => { verticalResizeRef.current = { kind: 'pipeline', pointerId: event.pointerId, startY: event.clientY, startHeight: pipelineHeight }; event.currentTarget.setPointerCapture(event.pointerId); }}
              onPointerMove={(event) => { const resize = verticalResizeRef.current; if (!resize || resize.kind !== 'pipeline' || resize.pointerId !== event.pointerId) return; setPipelineHeight(Math.max(180, Math.min(620, resize.startHeight + event.clientY - resize.startY))); }}
              onPointerUp={(event) => { verticalResizeRef.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId); }}
            ><span /></div>
            <section className="trace-flow-map" aria-label="Live end-to-end movement flow">
              <div className={`trace-stage ${telemetry?.valid ? 'live' : 'offline'}`}><span>1</span><strong>CC2650 BLE</strong><code>{fixedTrace(gyroDps)} deg/s</code><small>seq {telemetry?.sequence ?? '--'}</small></div>
              <b className={telemetry?.valid ? 'live' : ''}>BLE GATT</b>
              <div className={`trace-stage ${state.externalBridgeServerOnline ? 'live' : 'offline'}`}><span>2</span><strong>IoT Controller</strong><code>age {telemetry?.ageMs ?? '--'} ms</code><small>127.0.0.1:8765</small></div>
              <b className={state.externalBridgeServerOnline ? 'live' : ''}>FC16</b>
              <div className={`trace-stage ${state.openPlc.online && state.openPlc.runtimeRunning !== false ? 'live' : 'offline'}`}><span>3</span><strong>OpenPLC</strong><code>%QW127 = {state.openPlc.sensorPolicy ?? '--'}</code><small>{state.openPlc.runtimeRunning === false ? 'scan stopped' : motionPermit ? 'motion permit' : 'condition monitor'}</small></div>
              <b className={state.openPlc.online && state.openPlc.runtimeRunning !== false ? 'live' : ''}>ST logic</b>
              <div className={`trace-stage condition-${conditionState}`}><span>4</span><strong>PLC reaction</strong><code>{conditionLabel}</code><small>alarm {alarmCode} · speed {speedPermille}</small></div>
              <b className={state.frame ? 'live' : ''}>FC03</b>
              <div className={`trace-stage ${state.frame ? 'live' : 'offline'}`}><span>5</span><strong>3D twin</strong><code>{registers.length} joints</code><small>kinematicState</small></div>
            </section>
            <section className="trace-kpi-strip">
              <div><span>Motion</span><strong>{sensorMoving ? 'DETECTED' : 'STILL'}</strong><code>threshold 3 deg/s</code></div>
              <div><span>Gyro peak</span><strong>{fixedTrace(gyroPeak)}</strong><code>deg/s · {history.length} samples</code></div>
              <div><span>Joint transitions</span><strong>{jointChanges}</strong><code>current window</code></div>
              <div><span>Decision</span><strong>{conditionLabel}</strong><code>%QW95={conditionState}</code></div>
            </section>
            <section className="trace-joint-vector">
              {registers.slice(0, 6).map((register, index) => <div key={register.signalId}><span>J{index + 1}</span><strong>{register.value.toFixed(3)}</strong><code>{register.displayAddress}</code></div>)}
            </section>
          </>
        )}

        {layer === 'modbus' && (
          <div className="trace-modbus-layer">
            <section className="trace-wire-map"><h3>Live OpenPLC register map</h3><div className="trace-wire-map-head"><span>Wire</span><span>HR</span><span>Semantics</span><span>Encoding</span><span>Live value</span></div>{wireRows.map((row) => <div className="trace-wire-map-row" key={row.wire}><strong>{row.wire}</strong><code>{row.hr}</code><span>{row.semantic}</span><small>{row.encoding}</small><b>{row.value}</b></div>)}</section>
            <div className="trace-technical-grid">
            <section><h3>Joint holding registers</h3>{registers.map((register) => <div className="trace-register" key={register.signalId}><span>{register.jointName}</span><strong>HR {register.displayAddress}</strong><code>{register.value.toFixed(5)} · {register.registers.map((word) => `0x${word.toString(16).padStart(4, '0')}`).join(' ')}</code></div>)}</section>
            <section><h3>Live packet</h3>{latestPacket ? <><div className="trace-packet-meta"><strong>FC{latestPacket.functionCode}</strong><span>TID {latestPacket.transactionId} · Unit {latestPacket.unitId}</span></div><p>{latestPacket.decoded}</p><code className="trace-packet-hex">{latestPacket.hex}</code></> : <div className="empty-state compact">No Modbus packet observed.</div>}<h3>IoT register map</h3><div className="trace-register"><span>Gyroscope magnitude</span><strong>%QW122</strong><code>{fixedTrace(gyroDps)} deg/s x100</code></div><div className="trace-register"><span>Freshness</span><strong>%QW123</strong><code>{telemetry?.ageMs ?? '--'} ms</code></div><div className="trace-register"><span>Policy</span><strong>%QW127</strong><code>{state.openPlc.sensorPolicy ?? '--'}</code></div></section>
            </div>
          </div>
        )}

        {layer === 'plc' && (
          <div className="trace-plc-layer">
            <section className={`trace-plc-decision condition-${conditionState}`}><span>OpenPLC decision</span><strong>{conditionLabel}</strong><code>alarm {alarmCode} · speed {speedPermille} permille</code></section>
            <div className="trace-rule-list"><div><span>Telemetry valid</span><strong>{telemetry?.valid ? 'PASS' : 'FAIL'}</strong></div><div><span>Gyroscope available</span><strong>{telemetry?.hasGyroscope ? 'PASS' : 'FAIL'}</strong></div><div><span>Motion threshold</span><strong>{sensorMoving ? 'PASS' : 'WAIT'}</strong></div><div><span>Motion permit policy</span><strong>{motionPermit ? 'ACTIVE' : 'OFF'}</strong></div><div><span>Robot command</span><strong>{state.openPlc.command === 1 ? 'AUTO' : state.openPlc.command === 2 ? 'HOME' : 'MANUAL'}</strong></div></div>
            <section className="trace-timeline"><h3>Live evidence window</h3><div>{history.slice(-50).map((sample) => <i key={`${sample.sequence}-${sample.capturedAt}`} className={`condition-${sample.conditionState}`} style={{ height: `${Math.max(8, Math.min(100, sample.gyroDps / Math.max(gyroPeak, 1) * 100))}%` }} title={`seq ${sample.sequence}: ${sample.gyroDps.toFixed(2)} deg/s, state ${sample.conditionState}`} />)}</div></section>
          </div>
        )}

        {layer === 'scene' && (
          <div className="trace-scene-section" style={{ '--trace-scene-height': `${sceneHeight}px` } as CSSProperties}>
          <div className="trace-scene-layer">
            <PlcRobotMirror node={node} title="Physical process" subtitle="Joint vector decoded from OpenPLC holding registers." rows={registers} running={conditionState < 2 && speedPermille > 0} />
            <PlcRobotMirror node={node} title="Digital twin" subtitle="The same vector applied to KinematicGraph V2." rows={twinRows.length ? twinRows : registers} running={conditionState < 2 && speedPermille > 0} />
          </div>
          <div
            className="trace-height-resize-handle"
            role="separator"
            aria-label="Resize physical and digital twin scenes height"
            aria-orientation="horizontal"
            onPointerDown={(event) => { verticalResizeRef.current = { kind: 'scene', pointerId: event.pointerId, startY: event.clientY, startHeight: sceneHeight }; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={(event) => { const resize = verticalResizeRef.current; if (!resize || resize.kind !== 'scene' || resize.pointerId !== event.pointerId) return; setSceneHeight(Math.max(220, Math.min(720, resize.startHeight + event.clientY - resize.startY))); }}
            onPointerUp={(event) => { verticalResizeRef.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId); }}
          ><span /></div>
          </div>
        )}
      </div>
    </div>
  );
};

const fixedTrace = (value: number) => Number.isFinite(value) ? value.toFixed(2) : '--';

const PlcModbusDashboard = ({ node, state, onStart, onStop, onStep, onToggleAdvanced, onToggleTerminalBridge, onDisconnectTerminalBridge, onEndpointChange, onWriteRegister, onPlcInputChange, onPlcFaultReset, onPlcScanTargetChange, onToggleOpenPlc, onProbeOpenPlc, onTestPhysicalPlcConnection, onTestPhysicalPlcReaction, onTestPhysicalPlcJog, physicalPlcDemoActive, onTogglePhysicalPlcDemo, onOpenPlcCommand, onActivateLocalManual, onOpenPlcSensorPolicy, onOpenPlcConfigChange, historianRecording, historianRecordCount, onToggleHistorianRecording, onClose }: PlcModbusDashboardProps) => {
  const [mirrorHeight, setMirrorHeight] = useState(330);
  const mirrorResizeRef = useRef<{ pointerId: number; startY: number; startHeight: number }>();
  const physicalPlcActive = state.openPlc.endpointProfile === 's7-1200-robot-holding' && state.openPlc.enabled;
  const registers = (state.frame?.physicalRegisters ?? []).map((register, index) => physicalPlcActive
    ? { ...register, address: 7 + index, displayAddress: String(7 + index) }
    : register);
  const twinState = state.frame?.digitalTwinState ?? [];
  const visibleRows = Math.max(registers.length, twinState.length);
  const endpoint = parseModbusBridgeEndpoint(state.externalBridgeUrl);
  const receivedLabel = state.externalBridgeLastReceivedAt ? new Date(state.externalBridgeLastReceivedAt).toLocaleTimeString() : 'none';
  const clientLabel = state.externalBridgeClientIp ?? endpoint.host;
  const clientStatus = state.externalBridgeClientConnected ? 'connected' : state.externalBridgeServerOnline ? 'waiting' : 'off';
  const clampMirrorHeight = useCallback((height: number) => {
    const viewportLimit = typeof window === 'undefined' ? 680 : Math.max(260, Math.floor(window.innerHeight * 0.62));
    return Math.max(180, Math.min(viewportLimit, Math.round(height)));
  }, []);
  const dashboardStyle = { '--plc-mirror-height': `${mirrorHeight}px` } as CSSProperties;
  const twinRows: PlcRegister[] = twinState.map((item, index) => {
    const source = registers.find((register) => register.signalId === state.frame?.samples[index]?.signalId || register.jointId === item.jointId);
    return {
      address: source?.address ?? index * 2,
      displayAddress: item.modbusAddress || source?.displayAddress || String(40101 + index * 2),
      signalId: source?.signalId ?? item.signalPath,
      jointId: item.jointId,
      jointName: item.jointName,
      value: item.value,
      registers: source?.registers ?? [],
    };
  });
  const externalPlcActive = state.openPlc.enabled || state.externalBridgeEnabled;
  const mirrorRunning = state.openPlc.enabled
    ? Boolean(state.openPlc.online && state.openPlc.runtimeRunning !== false && state.openPlc.command === 1 && (state.openPlc.conditionState ?? 0) < 2)
    : state.running;
  const synchronizedTwinRows = externalPlcActive ? registers : (twinRows.length ? twinRows : registers);

  return (
    <div className={`plc-dashboard ${state.advanced ? 'advanced' : ''}`} style={dashboardStyle} onClick={(event) => event.stopPropagation()}>
      <div className="plc-dashboard-head">
        <div>
          <h2>Digital Twin Scenario</h2>
          <p>{node ? `${node.name} | Physical entity -> Modbus TCP -> Digital twin` : 'No kinematic object selected'}</p>
        </div>
        <div className="plc-dashboard-head-right">
          <div className="plc-dashboard-actions">
            <button title="Run simulated physical entity and publish Modbus registers" disabled={!node || state.running || state.openPlc.enabled} onClick={onStart}>
              <Play size={15} />
              <span>Run</span>
            </button>
            <button title="Apply one Modbus polling cycle" disabled={!node} onClick={onStep}>
              <Activity size={15} />
              <span>Step</span>
            </button>
            <button title="Stop simulated PLC publishing" disabled={!state.running} onClick={onStop}>
              <Pause size={15} />
              <span>Stop</span>
            </button>
            <button className={historianRecording ? 'active historian-dashboard-button' : 'historian-dashboard-button'} title="Persist live samples, events and commands in the TwinAxis historian" disabled={!state.frame} onClick={onToggleHistorianRecording}>
              {historianRecording ? <Pause size={15} /> : <Activity size={15} />}
              <span>{historianRecording ? `Stop Record (${historianRecordCount})` : `Record History (${historianRecordCount})`}</span>
            </button>
            <button
              className={state.externalBridgeEnabled ? 'active terminal-bridge-button' : 'terminal-bridge-button'}
              title={`Read live Modbus HR values from the visual gamepad controller on ${endpoint.host}:${endpoint.port}.`}
              disabled={!node || state.openPlc.enabled}
              onClick={onToggleTerminalBridge}
            >
              <Activity size={15} />
              <span>Visual Controller</span>
            </button>
            <button
              className="disconnect-bridge-button"
              title="Disconnect the visual controller client and stop reading live Modbus HR values."
              disabled={!state.externalBridgeEnabled && !state.externalBridgeClientConnected}
              onClick={onDisconnectTerminalBridge}
            >
              <X size={15} />
              <span>Disconnect Client</span>
            </button>
            <button className={state.advanced ? 'active' : ''} title="Show Modbus registers, packet hex frames and signal binding details" disabled={!node} onClick={onToggleAdvanced}>
              <ShieldCheck size={15} />
              <span>Advanced Details</span>
            </button>
            <button title="Close PLC test dashboard" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
          <div className="plc-endpoint-mini" aria-label="Modbus controller connection status">
            <label>
              <span>IP</span>
              <input value={endpoint.host} onChange={(event) => onEndpointChange('host', event.target.value)} />
            </label>
            <label>
              <span>Port</span>
              <input value={endpoint.port} inputMode="numeric" onChange={(event) => onEndpointChange('port', event.target.value)} />
            </label>
            <span className={state.externalBridgeOnline ? 'plc-bridge-online' : 'plc-bridge-offline'}>RX {state.externalBridgeOnline ? 'yes' : 'no'}</span>
            <span className={state.externalBridgeServerOnline ? 'plc-bridge-online' : 'plc-bridge-offline'}>server {state.externalBridgeServerOnline ? 'online' : 'off'}</span>
            <span className={state.externalBridgeClientConnected ? 'plc-bridge-online' : 'plc-bridge-offline'}>client {clientStatus}</span>
            <code title={endpoint.stateUrl}>Modbus Controller Endpoint {endpoint.host}:{endpoint.port} | client {clientLabel} | last {receivedLabel}</code>
          </div>
        </div>
      </div>

      <div className="plc-flow">
        <span className={mirrorRunning ? 'live' : ''}>{physicalPlcActive ? 'Physical PLC process image' : 'Simulated physical entity'}</span>
        <strong>Modbus HR</strong>
        <span>Digital twin 3D</span>
      </div>

      <section className={`virtual-plc-rack mode-${state.plc.mode.toLowerCase()}`} aria-label="Virtual industrial PLC">
        <div className="virtual-plc-identity">
          <div><strong>PLC-SIM 1500</strong><span>CPU 1516 compatible runtime</span></div>
          <span className={`plc-cpu-mode ${state.plc.mode.toLowerCase()}`}>{state.plc.mode}</span>
          <span>Program {state.plc.programState}</span>
          <span>Cycle {state.plc.scan.cycleCount}</span>
        </div>
        <div className="virtual-plc-safety">
          <button className={state.plc.inputs.emergencyStopHealthy ? 'input-ok' : 'input-fault'} title="Toggle the dual-channel emergency stop safety input" onClick={() => onPlcInputChange('emergencyStopHealthy', !state.plc.inputs.emergencyStopHealthy)}>
            <span className="io-led" />E-STOP {state.plc.inputs.emergencyStopHealthy ? 'READY' : 'TRIPPED'}
          </button>
          <button className={state.plc.inputs.guardClosed ? 'input-ok' : 'input-fault'} title="Toggle the safety guard input" onClick={() => onPlcInputChange('guardClosed', !state.plc.inputs.guardClosed)}>
            <span className="io-led" />GUARD {state.plc.inputs.guardClosed ? 'CLOSED' : 'OPEN'}
          </button>
          <button className={state.plc.inputs.servoReady ? 'input-ok' : 'input-fault'} title="Toggle the servo drive ready feedback" onClick={() => onPlcInputChange('servoReady', !state.plc.inputs.servoReady)}>
            <span className="io-led" />SERVO {state.plc.inputs.servoReady ? 'READY' : 'NOT READY'}
          </button>
          <button className={state.plc.inputs.automaticMode ? 'active' : ''} title="Select automatic or manual/homing program mode" onClick={() => onPlcInputChange('automaticMode', !state.plc.inputs.automaticMode)}>
            {state.plc.inputs.automaticMode ? 'AUTO' : 'MANUAL'}
          </button>
          <button className="plc-reset-button" title="Acknowledge alarms and reset the PLC after all safety inputs are restored" onClick={onPlcFaultReset}>RESET FAULT</button>
        </div>
        <div className="virtual-plc-process-image">
          <div><strong>Inputs</strong><span>I0.0 E-Stop <i className={state.plc.inputs.emergencyStopHealthy ? 'on' : ''} /></span><span>I0.1 Guard <i className={state.plc.inputs.guardClosed ? 'on' : ''} /></span><span>I0.2 Servo <i className={state.plc.inputs.servoReady ? 'on' : ''} /></span></div>
          <div><strong>Outputs</strong><span>Q0.0 Motor enable <i className={state.plc.outputs.motorEnable ? 'on' : ''} /></span><span>Q0.1 Cycle active <i className={state.plc.outputs.cycleActive ? 'on' : ''} /></span><span>Q0.2 Fault lamp <i className={state.plc.outputs.faultLamp ? 'fault' : ''} /></span></div>
          <label><span>Scan target</span><input type="number" min="5" max="500" value={state.plc.scan.targetMs} onChange={(event) => onPlcScanTargetChange(Number(event.target.value))} /><small>ms</small></label>
          <div className="plc-scan-metrics"><span>last {state.plc.scan.lastMs.toFixed(1)} ms</span><span>avg {state.plc.scan.averageMs.toFixed(1)} ms</span><span>max {state.plc.scan.maximumMs.toFixed(1)} ms</span><span>watchdog {state.plc.scan.watchdogLimitMs} ms</span></div>
        </div>
        {state.plc.alarms.some((alarm) => alarm.active) && (
          <div className="virtual-plc-alarms" role="alert">
            {state.plc.alarms.filter((alarm) => alarm.active).map((alarm) => <span key={alarm.code}><AlertTriangle size={12} />{alarm.code}: {alarm.message}</span>)}
          </div>
        )}
        {externalPlcActive && <div className="virtual-plc-authority">{physicalPlcActive ? `Physical PLC ${state.openPlc.host}:${state.openPlc.port} owns motion. Both 3D views use the same HR7..12 process image.` : 'External controller has write authority. Disconnect Client before running the internal PLC CPU.'}</div>}
        <div className={`openplc-connector ${state.openPlc.online && state.openPlc.runtimeRunning === false ? 'stalled' : state.openPlc.online ? 'online' : state.openPlc.enabled ? 'waiting' : ''}`}>
          <div className="openplc-title"><strong>{state.openPlc.endpointProfile === 's7-1200-robot-holding' ? 'Physical PLC · S7-1200' : 'OpenPLC Runtime'}</strong><span>{state.openPlc.online && state.openPlc.runtimeRunning === false ? 'MODBUS ONLINE · SCAN STOPPED' : state.openPlc.online ? 'ONLINE · SCAN ACTIVE' : state.openPlc.enabled ? 'CONNECTING' : 'OFFLINE'}</span></div>
          <label><span>PLC profile</span><select value={state.openPlc.endpointProfile} disabled={state.openPlc.enabled} onChange={(event) => onOpenPlcConfigChange('endpointProfile', event.target.value)}><option value="openplc">OpenPLC %QW</option><option value="s7-1200-robot-holding">Physical S7-1200 · HR0..20</option></select></label>
          <label><span>IP / host</span><input value={state.openPlc.host} disabled={state.openPlc.enabled} onChange={(event) => onOpenPlcConfigChange('host', event.target.value)} /></label>
          <label><span>Port</span><input type="number" min="1" max="65535" value={state.openPlc.port} disabled={state.openPlc.enabled} onChange={(event) => onOpenPlcConfigChange('port', event.target.value)} /></label>
          <label><span>Unit ID</span><input type="number" min="0" max="255" value={state.openPlc.unitId} disabled={state.openPlc.enabled} onChange={(event) => onOpenPlcConfigChange('unitId', event.target.value)} /></label>
          <label><span>HR start</span><input type="number" min="0" max="65535" value={state.openPlc.address} disabled={state.openPlc.enabled} onChange={(event) => onOpenPlcConfigChange('address', event.target.value)} /></label>
          <label><span>Data</span><select value={state.openPlc.dataFormat} disabled={state.openPlc.enabled} onChange={(event) => onOpenPlcConfigChange('dataFormat', event.target.value)}><option value="float32-be">FLOAT32 BE</option><option value="int16-rad-x10000">INT16 rad x10000</option></select></label>
          <label><span>Poll</span><input type="number" min="100" max="5000" step="50" value={state.openPlc.pollMs} disabled={state.openPlc.enabled} onChange={(event) => onOpenPlcConfigChange('pollMs', event.target.value)} /><small>ms</small></label>
          <label title="Remember this endpoint and resume polling automatically when the PLC network becomes available."><span>Reconnect</span><input type="checkbox" checked={state.openPlc.autoReconnect} disabled={state.openPlc.enabled} onChange={(event) => onOpenPlcConfigChange('autoReconnect', event.target.checked)} /><small>{state.openPlc.autoReconnect ? 'armed' : 'off'}</small></label>
          <button type="button" className={state.openPlc.enabled ? 'active openplc-button' : 'openplc-button'} title="Connect the selected PLC profile over Modbus TCP" disabled={!node} onClick={onToggleOpenPlc}><Link2 size={13} />{state.openPlc.enabled ? `Disconnect ${state.openPlc.endpointProfile === 's7-1200-robot-holding' ? 'Physical PLC' : 'OpenPLC'}` : `Connect ${state.openPlc.endpointProfile === 's7-1200-robot-holding' ? 'Physical PLC' : 'OpenPLC'}`}</button>
          <button type="button" disabled={state.openPlc.enabled || state.openPlc.probing} onClick={onProbeOpenPlc}><Activity size={13} />{state.openPlc.probing ? 'Detecting...' : 'Auto Detect Map'}</button>
          {state.openPlc.endpointProfile === 's7-1200-robot-holding' && (
            <div className="physical-plc-test-panel">
              <div className={`physical-plc-link-state ${state.openPlc.online ? 'connected' : 'disconnected'}`}>
                <i aria-hidden="true" />
                <strong>{state.openPlc.online ? 'PLC CONNECTED' : 'PLC DISCONNECTED'}</strong>
                <span>{state.openPlc.host}:{state.openPlc.port} · Unit {state.openPlc.unitId}</span>
              </div>
              <button type="button" disabled={state.openPlc.probing} onClick={() => void onTestPhysicalPlcConnection()}><Activity size={13} />{state.openPlc.probing ? 'Testing...' : 'Test Connection'}</button>
              <button type="button" className="physical-plc-reaction-test" disabled={state.openPlc.probing || !state.openPlc.online} title="Safety-confirmed test: writes HOME to HR0, verifies HR1/HR2, then returns HR0 to HOLD" onClick={() => void onTestPhysicalPlcReaction()}><RotateCw size={13} />Test HOME Reaction</button>
              <button type="button" disabled={state.openPlc.probing || !state.openPlc.online} title="Write a small reversible increment to HR7..HR12 while HR0 remains in manual hold" onClick={() => void onTestPhysicalPlcJog('forward')}><ChevronRight size={13} />Step Forward</button>
              <button type="button" disabled={state.openPlc.probing || !state.openPlc.online} title="Restore the exact HR7..HR12 vector captured before Step Forward" onClick={() => void onTestPhysicalPlcJog('return')}><Redo2 size={13} />Return to Start</button>
              <button type="button" className={physicalPlcDemoActive ? 'active' : ''} disabled={state.openPlc.probing || !state.openPlc.online} title="Stream the exact kinematic clip used by Start Demo to physical PLC HR7..HR12" onClick={() => void onTogglePhysicalPlcDemo()}>{physicalPlcDemoActive ? <Pause size={13} /> : <Play size={13} />}{physicalPlcDemoActive ? 'Stop PLC Demo' : 'Run Start Demo'}</button>
            </div>
          )}
          <code>FC03 · {state.openPlc.endpointProfile === 's7-1200-robot-holding' ? '21 HR process image' : `${state.openPlc.quantity} HR`} · Unit {state.openPlc.unitId} · RX {state.openPlc.received}</code>
          {state.openPlc.diagnostics && <code>{state.openPlc.diagnostics}</code>}
          {state.openPlc.runtimeIssue && <span className="openplc-runtime-error" role="alert">{state.openPlc.runtimeIssue}</span>}
          {state.openPlc.rawRegisters && <code>RAW [{state.openPlc.rawRegisters.join(', ')}]</code>}
          {state.openPlc.error && <span className="openplc-error">{state.openPlc.error}</span>}
          <div className="openplc-command-control" role="group" aria-label="PLC robot operating mode">
            <span>Robot mode · {state.openPlc.endpointProfile === 's7-1200-robot-holding' ? 'HR0' : '%QW90'}</span>
            <button type="button" className={state.localManualActive ? 'active manual' : ''} disabled={!node} title="Disconnect OpenPLC and give the local PLC manual authority over every robot joint" onClick={onActivateLocalManual}><Pause size={13} />Local Manual</button>
            <button type="button" className={state.openPlc.command === 1 ? 'active auto' : ''} disabled={!state.openPlc.enabled} title="Command 1: execute the automatic robot sequence continuously" onClick={() => onOpenPlcCommand(1)}><Play size={13} />Auto</button>
            <button type="button" className={state.openPlc.command === 2 ? 'active home' : ''} disabled={!state.openPlc.enabled} title="Command 2: move and hold the robot at its configured Home pose" onClick={() => onOpenPlcCommand(2)}><RotateCw size={13} />Home</button>
            <code>{state.openPlc.command} · {state.openPlc.command === 0 ? 'manual hold' : state.openPlc.command === 1 ? 'automatic cycle' : 'home pose'}</code>
          </div>
          <div className={`openplc-iot-reaction condition-${state.openPlc.conditionState ?? 3}`}>
            <div>
              <span>PLC reaction · {state.openPlc.endpointProfile === 's7-1200-robot-holding' ? 'HR4..6' : '%QW94..96'}</span>
              <strong>{['NORMAL', 'WARNING / DERATE', 'TRIP / HOLD', 'STALE / HOLD'][state.openPlc.conditionState ?? 3] ?? 'UNKNOWN'}</strong>
              <code>alarm {state.openPlc.alarmCode ?? '--'} · speed {state.openPlc.speedPermille ?? '--'} permille · step {state.openPlc.activeStep ?? '--'}</code>
            </div>
            <button type="button" className={state.openPlc.sensorPolicy === 0 ? 'active' : ''} disabled={!state.openPlc.enabled} onClick={() => onOpenPlcSensorPolicy(0)}>Condition monitor</button>
            <button type="button" className={state.openPlc.sensorPolicy === 1 ? 'active' : ''} disabled={!state.openPlc.enabled} title="Writes SensorPolicy=1 and Command=AUTO. Sensor motion releases HOLD; two seconds without motion stops the cycle." onClick={() => onOpenPlcSensorPolicy(1)}>Motion permit + Auto</button>
            <code>{state.openPlc.endpointProfile === 's7-1200-robot-holding' ? 'HR20' : '%QW127'} = {state.openPlc.sensorPolicy ?? 0}</code>
          </div>
        </div>
        <div className={`iot-condition-strip ${state.iotTelemetry?.valid ? 'live' : 'stale'}`}>
          <div><strong>Robot-mounted IoT</strong><span>{state.iotTelemetry?.valid ? state.iotTelemetry.source : 'No live IoT telemetry'}</span></div>
          <div><span>Temperature</span><strong>{state.iotTelemetry?.valid && state.iotTelemetry.hasEnvironment ? `${state.iotTelemetry.temperatureC.toFixed(1)} °C` : '--'}</strong><code>{state.iotTelemetry?.hasEnvironment ? (physicalPlcActive ? 'HR13' : '%QW120') : 'NO DATA'}</code></div>
          <div><span>Humidity</span><strong>{state.iotTelemetry?.valid && state.iotTelemetry.hasEnvironment ? `${state.iotTelemetry.humidityPercent.toFixed(1)} %RH` : '--'}</strong><code>{state.iotTelemetry?.hasEnvironment ? (physicalPlcActive ? 'HR14' : '%QW121') : 'NO DATA'}</code></div>
          <div><span>Gyro magnitude</span><strong>{state.iotTelemetry?.valid && state.iotTelemetry.hasGyroscope ? `${state.iotTelemetry.gyroDps.toFixed(1)} °/s` : '--'}</strong><code>{state.iotTelemetry?.hasGyroscope ? (physicalPlcActive ? 'HR15' : '%QW122') : 'NO DATA'}</code></div>
          <div><span>Freshness</span><strong>{state.iotTelemetry?.valid ? `${state.iotTelemetry.ageMs} ms` : '--'}</strong><code>{state.iotTelemetry?.valid ? 'VALID' : 'NO LIVE DATA'}</code></div>
          <div className="iot-trace-cell"><span>Trace</span><strong>{state.iotTelemetry?.valid ? state.iotTelemetry.sampleId || '--' : '--'}</strong><code>{state.iotTelemetry?.valid ? `seq ${state.iotTelemetry.sequence ?? 0} · ${state.iotTelemetry.quality ?? 'GOOD'}` : 'no received sample'}</code></div>
          <div className="iot-vector-cell"><span>Accelerometer XYZ</span><strong>{state.iotTelemetry?.valid && state.iotTelemetry.hasAcceleration ? `${state.iotTelemetry.accelX.toFixed(3)} | ${state.iotTelemetry.accelY.toFixed(3)} | ${state.iotTelemetry.accelZ.toFixed(3)} g` : '--'}</strong></div>
          <div className="iot-vector-cell"><span>Gyroscope GX / GY / GZ</span><strong>{state.iotTelemetry?.valid && state.iotTelemetry.hasGyroscope ? `${state.iotTelemetry.gyroX.toFixed(2)} | ${state.iotTelemetry.gyroY.toFixed(2)} | ${state.iotTelemetry.gyroZ.toFixed(2)} °/s` : '--'}</strong></div>
          <div className="iot-vector-cell"><span>Magnetometer MX / MY / MZ</span><strong>{state.iotTelemetry?.valid && state.iotTelemetry.hasMagnetometer ? `${state.iotTelemetry.magX.toFixed(0)} | ${state.iotTelemetry.magY.toFixed(0)} | ${state.iotTelemetry.magZ.toFixed(0)} raw` : '--'}</strong></div>
        </div>
      </section>

      <div
        className="plc-mirror-resize-handle"
        role="separator"
        aria-label="Resize physical entity and digital twin views"
        aria-orientation="horizontal"
        aria-valuemin={180}
        aria-valuemax={680}
        aria-valuenow={mirrorHeight}
        tabIndex={0}
        title="Drag vertically to resize both 3D views"
        onPointerDown={(event) => {
          mirrorResizeRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: mirrorHeight };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const resize = mirrorResizeRef.current;
          if (!resize || resize.pointerId !== event.pointerId) return;
          setMirrorHeight(clampMirrorHeight(resize.startHeight + resize.startY - event.clientY));
        }}
        onPointerUp={(event) => {
          if (mirrorResizeRef.current?.pointerId !== event.pointerId) return;
          mirrorResizeRef.current = undefined;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { mirrorResizeRef.current = undefined; }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          setMirrorHeight((current) => clampMirrorHeight(current + (event.key === 'ArrowUp' ? 24 : -24)));
        }}
      >
        <span />
      </div>

      <div className="plc-twin-split">
        <PlcRobotMirror
          node={node}
          title={physicalPlcActive ? 'Entidad Física · PLC Real' : 'Entidad Fisica Simulada'}
          subtitle={physicalPlcActive ? `Imagen de proceso recibida por FC03 desde ${state.openPlc.host}:${state.openPlc.port}, HR7..12.` : 'Proceso fisico controlado por scan, interlocks y salidas del PLC virtual.'}
          rows={registers}
          editable={state.localManualActive}
          running={mirrorRunning}
          onWriteRegister={onWriteRegister}
        />
        <PlcRobotMirror
          node={node}
          title="Gemelo Digital 3D"
          subtitle="Recibe datos decodificados y actualiza kinematicState."
          rows={synchronizedTwinRows}
          running={mirrorRunning}
        />
      </div>

      {state.advanced && (
        <div className="plc-advanced-details">
          <section>
            <h3>Modbus Register Map</h3>
            <div className="plc-register-list">
              {registers.map((register) => (
                <div key={`map-${register.signalId}`} className="plc-register-row">
                  <span>{register.jointName}</span>
                  <strong>HR {register.displayAddress}</strong>
                  <small>
                    wire {register.address} | f32 BE high-low | words {formatHexPair(register.registers)} | value {register.value.toFixed(4)}
                  </small>
                </div>
              ))}
              {!registers.length && <div className="empty-state compact">No register map generated yet.</div>}
            </div>
          </section>
          <section>
            <h3>Live Modbus TCP Packets</h3>
            <div className="plc-packet-list">
              {(state.frame?.modbusPackets ?? []).slice(-8).map((packet, index) => (
                <div key={`packet-${packet.transactionId}-${packet.direction}-${index}`} className={`plc-packet ${packet.direction}`}>
                  <div>
                    <strong>{packet.direction === 'request' ? 'PLC -> Twin' : 'Twin <- PLC'}</strong>
                    <span>
                      TID {packet.transactionId} | Unit {packet.unitId} | FC {packet.functionCode} | {packet.decoded}
                    </span>
                  </div>
                  <code>{packet.hex}</code>
                </div>
              ))}
              {!(state.frame?.modbusPackets?.length) && <div className="empty-state compact">Run or Step to inspect packet frames.</div>}
            </div>
          </section>
        </div>
      )}

      <footer className="plc-dashboard-footer">
        <span>{state.message}</span>
        <span className={state.externalBridgeOnline ? 'plc-bridge-online' : 'plc-bridge-offline'}>
          controller {state.externalBridgeEnabled ? (state.externalBridgeOnline ? 'online' : 'waiting') : 'off'}
        </span>
        <span>{visibleRows} joints</span>
        <span>seq {state.sequence}</span>
      </footer>
    </div>
  );
};

type KinematicGraphPanelProps = {
  node: SceneNode;
  selectedPartNames: string[];
  setKinematicJointValue: (nodeId: string, jointId: string, value: number) => void;
  setKinematicJointValues: (nodeId: string, values: Record<string, number>) => void;
  resetKinematicPose: (nodeId: string) => void;
  updateKinematicJoint: (nodeId: string, jointId: string, patch: Partial<KinematicJoint>) => void;
  updateKinematicGraph: (nodeId: string, updater: (graph: KinematicGraph) => KinematicGraph, status: string) => void;
  startKinematicEdit: (nodeId: string, jointId: string, mode: KinematicEditTarget['mode']) => void;
  acceptKinematicJoint: (nodeId: string, jointId: string) => void;
  commitKinematicJointFrame: (nodeId: string, jointId: string) => void;
  rejectKinematicJoint: (nodeId: string, jointId: string) => void;
  deleteKinematicJoint: (nodeId: string, jointId: string) => void;
  createKinematicJoint: (nodeId: string, selectedPartNames: string[]) => void;
  saveKinematicConfiguration: () => void | Promise<void>;
  robotCursorGuideActive: boolean;
  toggleRobotCursorGuide: (nodeId: string) => void;
};

type MechanicalInspectionPhase = 'idle' | 'running' | 'stopped' | 'done';

type MechanicalInspectionState = {
  phase: MechanicalInspectionPhase;
  index: number;
  step: 'forward' | 'back' | 'home';
  results: Record<string, 'pending' | 'testing' | 'pass'>;
};

const mechanicalTooltips = {
  analyze:
    'Analyze Mechanics reads the imported parts and KinematicGraph V2, counts candidates and validation issues, and does not change the original geometry.',
  showJoint: 'Show Joint centers the camera on this pivot and highlights the parent, child, axis and affected chain in the viewport.',
  pickOrigin: 'Pick Origin lets you click the real pivot point on the model surface when the joint rotates or slides around the wrong place.',
  axisGizmo: 'Axis Gizmo shows a 3D handle in the viewport so you can drag the movement axis until rotation or sliding follows the real mechanism.',
  twoPointAxis: 'Two-Point Axis uses two clicked points on the model and stores normalize(B-A) as the joint axis.',
  revolute: 'Rotate around pivot means the child part turns around the red origin point.',
  prismatic: 'Slide whole piece means both ends move together along the selected axis. Fixed-end lift keeps the red pivot fixed and moves the driven end.',
  parent: 'Parent is the fixed reference side of the joint; movement propagates from parent to child.',
  child: 'Child is the moving side of the joint; the affected chain follows this part.',
  home: 'Home returns every tested joint value to its saved neutral pose without deleting the kinematic definition.',
  mimic: 'Mimic links this joint to a driver joint, useful for grippers where two fingers move in opposite directions.',
  validate: 'Validate checks graph structure, floating parts, invalid joints and incompatible values before saving.',
  save: 'Save stores the inspected kinematic configuration in the current project/autosave so reload keeps the same behavior.',
  testAll: 'Test All Joints moves one joint at a time within safe limits, returns to Home after each test and never auto-saves a definition.',
  stop: 'Stop immediately interrupts the running movement test and returns the model to Home.',
};

const humanJointState = (joint: KinematicJoint, issues: string[]) => {
  if (joint.status === 'rejected') return 'Invalid';
  if (issues.length) return 'Needs attention';
  if (joint.status === 'validated' || joint.status === 'manual') return 'Validated';
  return 'Candidate';
};

const issueText = (code: string) => {
  const readable: Record<string, string> = {
    MULTIPLE_PARENTS: 'A part has more than one mechanical parent.',
    ORPHAN_PART: 'A detected part is floating outside the reachable chain.',
    INVALID_LIMITS: 'The movement limits contradict each other.',
    MISSING_PART: 'A joint references a part that is not available.',
    KINEMATIC_CYCLE: 'The mechanical chain loops back into itself.',
  };
  return readable[code] ?? code.replace(/_/g, ' ').toLowerCase();
};

const KinematicGraphPanel = ({
  node,
  selectedPartNames,
  setKinematicJointValue,
  setKinematicJointValues,
  resetKinematicPose,
  updateKinematicJoint,
  updateKinematicGraph,
  startKinematicEdit,
  acceptKinematicJoint,
  commitKinematicJointFrame,
  rejectKinematicJoint,
  deleteKinematicJoint,
  createKinematicJoint,
  saveKinematicConfiguration,
  robotCursorGuideActive,
  toggleRobotCursorGuide,
}: KinematicGraphPanelProps) => {
  const graph = graphFromGeometry(node.geometry);
  if (!graph || !kinematicGeometryWithGraph(node.geometry)) {
    return <div className="empty-state">This object has no kinematic graph.</div>;
  }
  const geometry = node.geometry;
  const partById = new Map(graph.parts.map((part) => [part.id, part]));
  const validatedCount = graph.joints.filter((joint) => joint.status === 'validated').length;
  const candidateCount = graph.joints.filter((joint) => joint.status === 'candidate').length;
  const rejectedCount = graph.joints.filter((joint) => joint.status === 'rejected').length;
  const coupledCount = graph.joints.filter((joint) => joint.coupling).length;
  const movableParts = graph.parts.filter((part) => !part.static).length;
  const validationIssues = validateKinematicGraph(graph);
  const issueByJoint = new Map<string, string[]>();
  validationIssues.forEach((issue) => {
    if (!issue.jointId) return;
    issueByJoint.set(issue.jointId, [...(issueByJoint.get(issue.jointId) ?? []), issue.code]);
  });
  const state = geometry.kinematicState ?? createHomeKinematicState(graph);
  const [selectedJointId, setSelectedJointId] = useState<string | undefined>(() => graph.joints[0]?.id);
  const [simpleMode, setSimpleMode] = useState(true);
  const [guideVisible, setGuideVisible] = useState(() => !window.localStorage.getItem('asset-forge.mechanical-guide-dismissed'));
  const [analyzed, setAnalyzed] = useState(false);
  const [repairJointId, setRepairJointId] = useState<string | undefined>();
  const [inspectionMessage, setInspectionMessage] = useState('Import a model, analyze mechanics, then test and validate each real movement.');
  const [autoTest, setAutoTest] = useState<MechanicalInspectionState>({ phase: 'idle', index: 0, step: 'forward', results: {} });
  const [tutorialRequest, setTutorialRequest] = useState(0);

  useEffect(() => {
    const openAdvancedRig = () => {
      setSimpleMode(false);
      setTutorialRequest((current) => current + 1);
      window.setTimeout(() => document.querySelector('.advanced-rig-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    };
    window.addEventListener('asset-forge:open-advanced-rig', openAdvancedRig);
    return () => window.removeEventListener('asset-forge:open-advanced-rig', openAdvancedRig);
  }, []);
  const [clipPlayback, setClipPlayback] = useState<{ clipId: string; startedAt: number } | undefined>();
  const [robotPlayback, setRobotPlayback] = useState<{ controller: RobotServoState; lastAt: number } | undefined>();
  const selectedJoint = graph.joints.find((joint) => joint.id === selectedJointId) ?? graph.joints[0];
  const needsReviewCount = graph.joints.filter((joint) => humanJointState(joint, issueByJoint.get(joint.id) ?? []) === 'Needs attention').length;
  const isConveyorRig = graph.analysisVersion?.startsWith('conveyor-rig');
  const fullArmClip = graph.motionClips?.find((clip) => /pick|place|ciclo/i.test(clip.name)) ?? graph.motionClips?.[0];
  const jointByJointClip = graph.motionClips?.find((clip) => /demo|ejes|axis/i.test(clip.name));
  const activeClip = clipPlayback ? graph.motionClips?.find((clip) => clip.id === clipPlayback.clipId) : undefined;

  useEffect(() => {
    if (!selectedJointId || !graph.joints.some((joint) => joint.id === selectedJointId)) {
      setSelectedJointId(graph.joints[0]?.id);
    }
  }, [graph.joints, selectedJointId]);

  const sliderRange = (joint: KinematicJoint) => {
    if (joint.type === 'prismatic') return { min: joint.limits?.lower ?? -1, max: joint.limits?.upper ?? 1, step: 0.01 };
    if (joint.type === 'continuous') return { min: -Math.PI * 2, max: Math.PI * 2, step: 0.01 };
    return { min: joint.limits?.lower ?? -Math.PI, max: joint.limits?.upper ?? Math.PI, step: 0.01 };
  };

  const testValue = (joint: KinematicJoint, direction: -1 | 1) => {
    const range = sliderRange(joint);
    const softPositive = Math.min(range.max, joint.type === 'prismatic' ? 0.2 : 0.65);
    const softNegative = Math.max(range.min, joint.type === 'prismatic' ? -0.2 : -0.65);
    const value = direction > 0 ? softPositive : softNegative;
    return Math.abs(value) < 0.0001 ? direction * Math.min(0.25, Math.max(Math.abs(range.max), Math.abs(range.min), 0.25)) : value;
  };

  useEffect(() => {
    if (autoTest.phase !== 'running') return undefined;
    const joint = graph.joints[autoTest.index];
    if (!joint) {
      resetKinematicPose(node.id);
      setAutoTest((current) => ({ ...current, phase: 'done', step: 'home', index: Math.max(0, graph.joints.length - 1) }));
      setInspectionMessage('Everything looks correct if each highlighted joint moved as expected. Review joints if a motion looked wrong.');
      return undefined;
    }

    const timer = window.setTimeout(() => {
      if (autoTest.step === 'forward') {
        setSelectedJointId(joint.id);
        startKinematicEdit(node.id, joint.id, 'show-joint');
        setKinematicJointValue(node.id, joint.id, testValue(joint, 1));
        setAutoTest((current) => ({ ...current, step: 'back', results: { ...current.results, [joint.id]: 'testing' } }));
        return;
      }
      if (autoTest.step === 'back') {
        setKinematicJointValue(node.id, joint.id, testValue(joint, -1));
        setAutoTest((current) => ({ ...current, step: 'home' }));
        return;
      }
      setKinematicJointValue(node.id, joint.id, 0);
      setAutoTest((current) => ({
        ...current,
        index: current.index + 1,
        step: 'forward',
        results: { ...current.results, [joint.id]: 'pass' },
      }));
    }, 520);

    return () => window.clearTimeout(timer);
  }, [autoTest, graph.joints, node.id, resetKinematicPose, setKinematicJointValue, startKinematicEdit]);

  useEffect(() => {
    if (!robotPlayback) return undefined;
    const timer = window.setInterval(() => {
      setRobotPlayback((current) => {
        if (!current) return undefined;
        const now = performance.now();
        const result = updateRobotServo(graph, current.controller, (now - current.lastAt) / 1000, state);
        setKinematicJointValues(node.id, result.kinematicState.jointValues);
        if (!result.state.activeClip && (!result.state.sequence || result.state.sequence.completed)) {
          setInspectionMessage(result.activeLabel ? `${result.activeLabel} finished.` : 'Robot motion finished.');
          return undefined;
        }
        return { controller: result.state, lastAt: now };
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [robotPlayback, graph, node.id, setKinematicJointValues, state]);

  useEffect(() => {
    if (!clipPlayback) return undefined;
    const clip = graph.motionClips?.find((candidate) => candidate.id === clipPlayback.clipId);
    if (!clip) {
      setClipPlayback(undefined);
      return undefined;
    }
    const timer = window.setInterval(() => {
      const elapsed = (performance.now() - clipPlayback.startedAt) / 1000;
      setKinematicJointValues(node.id, sampleKinematicMotionClip(clip, elapsed));
      if (!clip.loop && elapsed >= clip.duration) {
        setInspectionMessage(`${clip.name} finished.`);
        setClipPlayback(undefined);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [clipPlayback, graph.motionClips, node.id, setKinematicJointValues]);

  const updateAxis = (joint: KinematicJoint, axis: [number, number, number]) => {
    updateKinematicJoint(node.id, joint.id, { axis });
  };

  const updateOrigin = (joint: KinematicJoint, position: [number, number, number]) => {
    updateKinematicJoint(node.id, joint.id, { origin: { ...joint.origin, position } });
  };

  const startInspection = () => {
    resetKinematicPose(node.id);
    setAnalyzed(true);
    setAutoTest({
      phase: 'running',
      index: 0,
      step: 'forward',
      results: Object.fromEntries(graph.joints.map((joint) => [joint.id, 'pending'])),
    });
    setInspectionMessage('Mechanical Inspection is running. Use Stop if any movement is unsafe or clearly wrong.');
  };

  const stopInspection = () => {
    resetKinematicPose(node.id);
    setAutoTest((current) => ({ ...current, phase: 'stopped', step: 'home' }));
    setInspectionMessage('Inspection stopped and model returned to Home.');
  };

  const playMotionClip = (clip: KinematicMotionClip | undefined) => {
    if (!clip) {
      setInspectionMessage('This model does not include a professional motion clip.');
      return;
    }
    setAutoTest((current) => (current.phase === 'running' ? { ...current, phase: 'stopped', step: 'home' } : current));
    setClipPlayback({ clipId: clip.id, startedAt: performance.now() });
    setRobotPlayback(undefined);
    setInspectionMessage(`Playing ${clip.name}: ${clip.description ?? 'professional robot motion'}.`);
  };

  const stopMotionClip = () => {
    setClipPlayback(undefined);
    setRobotPlayback(undefined);
    setInspectionMessage(activeClip ? `${activeClip.name} stopped.` : 'Robot animation stopped.');
  };

  const playProgrammaticPickAndPlace = () => {
    const controller = startRobotSequence(createRobotServoState(graph, state), 'Pick and place programatico', buildRobotPickAndPlaceSequence());
    setAutoTest((current) => (current.phase === 'running' ? { ...current, phase: 'stopped', step: 'home' } : current));
    setClipPlayback(undefined);
    setRobotPlayback({ controller, lastAt: performance.now() });
    setInspectionMessage('Playing programmatic pick-and-place: servo targets, speed limits, grip waits and Home return.');
  };

  const validateGraph = () => {
    setAnalyzed(true);
    setInspectionMessage(validationIssues.length ? 'Review joints before saving. Validation found issues that need correction.' : 'Graph validated. You can save and reload this setup.');
  };

  const repairWith = (joint: KinematicJoint, problem: string) => {
    setRepairJointId(joint.id);
    setInspectionMessage(`Repair mode: ${problem}. Follow the highlighted tool for ${joint.name}.`);
    if (problem === 'Wrong pivot') startKinematicEdit(node.id, joint.id, 'pick-origin');
    if (problem === 'Wrong axis') startKinematicEdit(node.id, joint.id, 'axis-gizmo');
    if (problem === 'Rotates instead of slides') updateKinematicJoint(node.id, joint.id, { type: 'prismatic' });
    if (problem === 'Slides instead of rotates') updateKinematicJoint(node.id, joint.id, { type: 'revolute' });
    if (problem === 'Inverted direction') updateAxis(joint, [-joint.axis[0], -joint.axis[1], -joint.axis[2]]);
  };

  const setupSteps = [
    { label: 'Import Model', status: 'completed' },
    { label: 'Analyze Parts', status: analyzed || graph.parts.length ? 'completed' : 'pending' },
    { label: 'Review Joints', status: graph.joints.length ? (needsReviewCount ? 'warning' : 'completed') : 'pending' },
    { label: 'Test Movements', status: autoTest.phase === 'done' ? 'completed' : autoTest.phase === 'running' ? 'in-progress' : 'pending' },
    { label: 'Fix Problems', status: needsReviewCount || repairJointId ? 'warning' : 'completed' },
    { label: 'Validate', status: validationIssues.length ? 'warning' : 'completed' },
    { label: 'Save', status: 'pending' },
  ];

  const gripperDrivers = graph.joints.filter((joint) => graph.joints.some((candidate) => candidate.coupling?.driverJointId === joint.id));

  const dismissGuide = () => {
    window.localStorage.setItem('asset-forge.mechanical-guide-dismissed', 'true');
    setGuideVisible(false);
  };

  return (
    <div className={simpleMode ? 'kinematic-graph-panel mechanical-panel simple' : 'kinematic-graph-panel mechanical-panel advanced'}>
      <div className="section-title-row">
        <h4>Mechanical Setup</h4>
        <span>Kinematic Graph V2 | Kinematic Authoring | {graph.joints.length} joints</span>
      </div>

      {guideVisible && (
        <div className="mechanical-guide">
          <strong>First setup</strong>
          <p>Load the robot, analyze mechanics, show each joint, test movement, correct wrong pivots or axes, then validate and save.</p>
          <button title="Dismiss this first experience guide" onClick={dismissGuide}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="mechanical-mode-toggle">
        <button className={simpleMode ? 'active' : ''} title="Simple Mode shows the guided mechanical workflow for daily inspection." onClick={() => setSimpleMode(true)}>
          Simple
        </button>
        <button className={!simpleMode ? 'active' : ''} title="Advanced Mode shows raw axis, origin, limits and mimic controls for precise calibration." onClick={() => setSimpleMode(false)}>
          Advanced
        </button>
      </div>

      <div className="mechanical-steps" aria-label="Mechanical Setup Flow">
        {setupSteps.map((step) => (
          <span key={step.label} className={`step-${step.status}`}>
            {step.label}
          </span>
        ))}
      </div>

      <div className="mechanical-summary">
        <span>Parts {graph.parts.length}</span>
        <span>Joint candidates {candidateCount}</span>
        <span>Validated joints {validatedCount}</span>
        <span>Needs review {needsReviewCount}</span>
        <span>Rejected {rejectedCount}</span>
        <span>Coupled {coupledCount}</span>
        <span>Graph {validationIssues.length ? 'Review' : 'Valid'}</span>
      </div>
      {!simpleMode && (
        <AdvancedRigWorkspace
          nodeId={node.id}
          graph={graph}
          state={state}
          selectedJointId={selectedJoint?.id}
          onSelectedJointChange={setSelectedJointId}
          onGraphChange={(updater, nextStatus) => updateKinematicGraph(node.id, updater, nextStatus)}
          onJointChange={(jointId, patch) => updateKinematicJoint(node.id, jointId, patch)}
          onJointValueChange={(jointId, value) => setKinematicJointValue(node.id, jointId, value)}
          onJointValuesChange={(values) => setKinematicJointValues(node.id, values)}
          onResetPose={() => resetKinematicPose(node.id)}
          onShowJoint={(jointId, mode) => startKinematicEdit(node.id, jointId, mode)}
          onSave={saveKinematicConfiguration}
          onCommitJointFrame={(jointId) => commitKinematicJointFrame(node.id, jointId)}
          tutorialRequest={tutorialRequest}
        />
      )}
      <div className="kinematic-authoring-actions">
        <button
          title={mechanicalTooltips.analyze}
          onClick={() => {
            setAnalyzed(true);
            setInspectionMessage(`${graph.parts.length} parts, ${graph.joints.length} joints and ${validationIssues.length} validation issues found.`);
          }}
        >
          <Activity size={14} />
          <span>Analyze Mechanics</span>
        </button>
        <button title="Create a candidate joint from exactly two selected model parts." disabled={selectedPartNames.length < 2} onClick={() => createKinematicJoint(node.id, selectedPartNames)}>
          <Hammer size={14} />
          <span>Create Joint</span>
        </button>
        <button title={mechanicalTooltips.testAll} disabled={!graph.joints.length || autoTest.phase === 'running'} onClick={startInspection}>
          <Play size={14} />
          <span>Test All Joints</span>
        </button>
        <button title={isConveyorRig ? 'Animate the conveyor with the imported industrial transport cycle.' : 'Animate the full robot with the imported professional sequence.'} disabled={!fullArmClip || Boolean(robotPlayback)} onClick={() => playMotionClip(fullArmClip)}>
          <Activity size={14} />
          <span>{isConveyorRig ? 'Auto cinta' : 'Auto brazo completo'}</span>
        </button>
        <button
          className={robotCursorGuideActive ? 'active' : ''}
          title="Grab the robot arm in the viewport and drag the cursor. The controller solves the base, shoulder, elbow and wrist as one chain."
          disabled={Boolean(robotPlayback) || graph.joints.length < 4}
          onClick={() => toggleRobotCursorGuide(node.id)}
        >
          <Move3D size={14} />
          <span>{robotCursorGuideActive ? 'Soltar cursor' : 'Guiar con cursor'}</span>
        </button>
        <button title="Run the controller-style pick-and-place sequence with velocity limits, waits and gripper timing." disabled={Boolean(robotPlayback)} onClick={playProgrammaticPickAndPlace}>
          <Activity size={14} />
          <span>Pick & place codigo</span>
        </button>
        <button title="Run the imported joint-by-joint diagnostic clip so every axis can be visually verified." disabled={!jointByJointClip || Boolean(robotPlayback)} onClick={() => playMotionClip(jointByJointClip)}>
          <Play size={14} />
          <span>Demo eje por eje</span>
        </button>
        <button title={mechanicalTooltips.stop} disabled={autoTest.phase !== 'running'} onClick={stopInspection}>
          <Pause size={14} />
          <span>Stop</span>
        </button>
        <button title="Stop the professional robot animation without deleting the kinematic definition." disabled={!clipPlayback && !robotPlayback} onClick={stopMotionClip}>
          <Pause size={14} />
          <span>Stop animacion</span>
        </button>
        <button title={mechanicalTooltips.home} onClick={() => resetKinematicPose(node.id)}>
          <RotateCw size={14} />
          <span>Home</span>
        </button>
        <button title={mechanicalTooltips.validate} onClick={validateGraph}>
          <ShieldCheck size={14} />
          <span>Validate</span>
        </button>
        <button
          title={mechanicalTooltips.save}
          onClick={() => {
            void saveKinematicConfiguration();
            setInspectionMessage('Mechanical setup saved in the current project.');
          }}
        >
          <Save size={14} />
          <span>Save</span>
        </button>
      </div>
      <div className="mechanical-status-line">{inspectionMessage}</div>
      <details className="context-help">
        <summary title="Open contextual help for Mechanical Setup">
          <HelpCircle size={14} />
          <span>Help</span>
        </summary>
        <p>Parent is the reference part, child is the moving part, origin is the pivot, axis is the rotation or slide direction, and limits protect the test range.</p>
      </details>
      {validationIssues.length ? (
        <div className="kinematic-validation-summary">
          {validationIssues.slice(0, 3).map((issue) => (
            <span key={`${issue.code}-${issue.jointId ?? issue.partId ?? 'graph'}`}>{issueText(issue.code)}</span>
          ))}
        </div>
      ) : (
        <div className="kinematic-validation-summary ok">
          <span>VALID GRAPH</span>
        </div>
      )}
      {autoTest.phase !== 'idle' && (
        <div className="mechanical-test-results">
          <strong>{autoTest.phase === 'done' ? 'Everything looks correct' : autoTest.phase === 'stopped' ? 'Inspection stopped' : `Testing ${autoTest.index + 1}/${graph.joints.length}`}</strong>
          {graph.joints.slice(0, 8).map((joint) => (
            <span key={joint.id} className={`result-${autoTest.results[joint.id] ?? 'pending'}`}>
              {joint.name}: {autoTest.results[joint.id] ?? 'pending'}
            </span>
          ))}
          {autoTest.phase === 'done' && <button title="Review joints that looked mechanically wrong during the automatic inspection." onClick={() => setInspectionMessage('Select the wrong joint, choose Movement incorrect, then choose the repair reason.')}>Review joints</button>}
        </div>
      )}
      {graph.joints.length ? (
        <div className="kinematic-joint-list">
          {graph.joints.map((joint) => (
            <div key={joint.id} className={selectedJoint?.id === joint.id ? 'kinematic-joint-row selected' : 'kinematic-joint-row'}>
              <div className="joint-title-line">
                <button title={`Select joint ${joint.name} and open its movement controls.`} onClick={() => setSelectedJointId(joint.id)}>
                  <strong title={joint.name}>{joint.name}</strong>
                </button>
                <span>{humanJointState(joint, issueByJoint.get(joint.id) ?? [])}</span>
              </div>
              <div className="joint-readable-links">
                <span title={mechanicalTooltips.parent}>Parent: {partById.get(joint.parentPartId)?.name ?? joint.parentPartId}</span>
                <span title={mechanicalTooltips.child}>Child: {partById.get(joint.childPartId)?.name ?? joint.childPartId}</span>
              </div>
              <div className="joint-visual-tools primary">
                <button title={mechanicalTooltips.showJoint} onClick={() => startKinematicEdit(node.id, joint.id, 'show-joint')}>
                  <Eye size={14} />
                  <span>Show Joint</span>
                </button>
                <button title="Movement correct marks this candidate as validated after visual confirmation." onClick={() => acceptKinematicJoint(node.id, joint.id)}>
                  <Check size={14} />
                  <span>Movement correct</span>
                </button>
                <button title="Movement incorrect opens guided repair choices for pivot, axis, type, limits or part selection." onClick={() => setRepairJointId(repairJointId === joint.id ? undefined : joint.id)}>
                  <AlertTriangle size={14} />
                  <span>Movement incorrect</span>
                </button>
              </div>
              {repairJointId === joint.id && (
                <div className="guided-repair">
                  {['Wrong pivot', 'Wrong axis', 'Rotates instead of slides', 'Slides instead of rotates', 'Inverted direction', 'Wrong limits', 'Wrong piece', 'Other'].map((problem) => (
                    <button key={problem} title={`Repair path: ${problem}`} onClick={() => repairWith(joint, problem)}>
                      {problem}
                    </button>
                  ))}
                </div>
              )}
              <div className="joint-authoring-grid">
                <label>
                  <span title={mechanicalTooltips.parent}>Parent</span>
                  <select value={joint.parentPartId} onChange={(event) => updateKinematicJoint(node.id, joint.id, { parentPartId: event.target.value })}>
                    {graph.parts.map((part) => (
                      <option key={part.id} value={part.id}>
                        {part.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span title={mechanicalTooltips.child}>Child</span>
                  <select value={joint.childPartId} onChange={(event) => updateKinematicJoint(node.id, joint.id, { childPartId: event.target.value })}>
                    {graph.parts.map((part) => (
                      <option key={part.id} value={part.id}>
                        {part.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span title={`${mechanicalTooltips.revolute} ${mechanicalTooltips.prismatic}`}>Type</span>
                  <select value={joint.type} onChange={(event) => updateKinematicJoint(node.id, joint.id, { type: event.target.value as KinematicJoint['type'] })}>
                    {['fixed', 'revolute', 'continuous', 'prismatic'].map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="axis-buttons">
                  <button title="Use X axis" onClick={() => updateAxis(joint, [1, 0, 0])}>X</button>
                  <button title="Use Y axis" onClick={() => updateAxis(joint, [0, 1, 0])}>Y</button>
                  <button title="Use Z axis" onClick={() => updateAxis(joint, [0, 0, 1])}>Z</button>
                </div>
              </div>
              <details className="advanced-kinematic-fields" open={!simpleMode}>
                <summary title="Advanced Mode exposes raw numeric axis and origin values for precise calibration.">Advanced vectors and limits</summary>
                <VectorEditor
                  label="Axis"
                  values={joint.axis}
                  step={0.01}
                  onChange={(index, value) => {
                    const next: [number, number, number] = [...joint.axis];
                    next[index] = value;
                    updateAxis(joint, next);
                  }}
                />
                <VectorEditor
                  label="Origin"
                  values={joint.origin.position}
                  step={0.01}
                  onChange={(index, value) => {
                    const next: [number, number, number] = [...joint.origin.position];
                    next[index] = value;
                    updateOrigin(joint, next);
                  }}
                />
              <div className="joint-authoring-grid compact">
                <label>
                  <span>Min</span>
                  <input
                    type="number"
                    step={0.01}
                    value={joint.limits?.lower ?? ''}
                    onChange={(event) => updateKinematicJoint(node.id, joint.id, { limits: { ...joint.limits, lower: Number(event.target.value) } })}
                  />
                </label>
                <label>
                  <span>Max</span>
                  <input
                    type="number"
                    step={0.01}
                    value={joint.limits?.upper ?? ''}
                    onChange={(event) => updateKinematicJoint(node.id, joint.id, { limits: { ...joint.limits, upper: Number(event.target.value) } })}
                  />
                </label>
              </div>
              <div className="joint-authoring-grid compact">
                <label>
                  <span title={mechanicalTooltips.mimic}>Mimic</span>
                  <select
                    value={joint.coupling?.driverJointId ?? ''}
                    onChange={(event) =>
                      updateKinematicJoint(node.id, joint.id, {
                        coupling: event.target.value
                          ? { driverJointId: event.target.value, multiplier: joint.coupling?.multiplier ?? 1, offset: joint.coupling?.offset ?? 0 }
                          : undefined,
                      })
                    }
                  >
                    <option value="">none</option>
                    {graph.joints
                      .filter((candidate) => candidate.id !== joint.id)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  <span>Multiplier</span>
                  <input
                    type="number"
                    step={0.1}
                    disabled={!joint.coupling}
                    value={joint.coupling?.multiplier ?? 1}
                    onChange={(event) =>
                      joint.coupling &&
                      updateKinematicJoint(node.id, joint.id, { coupling: { ...joint.coupling, multiplier: Number(event.target.value) } })
                    }
                  />
                </label>
                <label>
                  <span>Offset</span>
                  <input
                    type="number"
                    step={0.01}
                    disabled={!joint.coupling}
                    value={joint.coupling?.offset ?? 0}
                    onChange={(event) =>
                      joint.coupling && updateKinematicJoint(node.id, joint.id, { coupling: { ...joint.coupling, offset: Number(event.target.value) } })
                    }
                  />
                </label>
              </div>
              </details>
              <div className="joint-visual-tools">
                <button title={mechanicalTooltips.pickOrigin} onClick={() => startKinematicEdit(node.id, joint.id, 'pick-origin')}>
                  <Circle size={14} />
                  <span>Pick Origin</span>
                </button>
                <button title={mechanicalTooltips.axisGizmo} onClick={() => startKinematicEdit(node.id, joint.id, 'axis-gizmo')}>
                  <Move3D size={14} />
                  <span>Axis Gizmo</span>
                </button>
                <button title={mechanicalTooltips.twoPointAxis} onClick={() => startKinematicEdit(node.id, joint.id, 'pick-axis-a')}>
                  <Square size={14} />
                  <span>Axis A</span>
                </button>
                <button title={mechanicalTooltips.twoPointAxis} onClick={() => startKinematicEdit(node.id, joint.id, 'pick-axis-b')}>
                  <Square size={14} />
                  <span>Axis B</span>
                </button>
              </div>
              <Slider
                label="Test"
                value={state.jointValues[joint.id] ?? 0}
                {...sliderRange(joint)}
                onChange={(value) => setKinematicJointValue(node.id, joint.id, value)}
              />
              <div className="joint-authoring-actions">
                <button title="Accept joint" onClick={() => acceptKinematicJoint(node.id, joint.id)}>
                  <Check size={14} />
                </button>
                <button title="Reject joint" onClick={() => rejectKinematicJoint(node.id, joint.id)}>
                  <X size={14} />
                </button>
                <button title="Reset test to zero" onClick={() => setKinematicJointValue(node.id, joint.id, 0)}>
                  <RotateCw size={14} />
                </button>
                <button title="Delete joint" onClick={() => deleteKinematicJoint(node.id, joint.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
              <dl>
                <dt>Evidence</dt>
                <dd>{joint.evidence.map((item) => item.type).join(', ') || 'none'}</dd>
                <dt>Issues</dt>
                <dd>{issueByJoint.get(joint.id)?.map(issueText).join(', ') ?? 'none'}</dd>
              </dl>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">No joints yet. Select two visible parts in Parts mode, then create a candidate joint.</div>
      )}
      {gripperDrivers.length > 0 && (
        <div className="gripper-control">
          <strong>Gripper</strong>
          {gripperDrivers.slice(0, 2).map((joint) => (
            <Slider key={joint.id} label="Open / Close" value={state.jointValues[joint.id] ?? 0} {...sliderRange(joint)} onChange={(value) => setKinematicJointValue(node.id, joint.id, value)} />
          ))}
        </div>
      )}
    </div>
  );
};

type GeometryInspectorProps = {
  node: SceneNode;
  setGeometryValue: (field: string, value: number) => void;
  setImportedJointMotion: (jointName: string, value: number) => void;
  resetImportedJointPose: () => void;
  normalizeImportedModel: () => void;
  demoActive: boolean;
  toggleImportedMotionDemo: () => void;
  trainingCandidate?: MotionTrainingCandidate;
  trainingProgress?: { current: number; total: number };
  startMotionTrainer: () => void;
  acceptMotionTest: () => void;
  rejectMotionTest: () => void;
  stopMotionTrainer: () => void;
  moveValidatedMotion: (nodeId: string, motionId: string, direction: -1 | 1) => void;
  removeValidatedMotion: (nodeId: string, motionId: string) => void;
  selectedPartNames: string[];
  setKinematicJointValue: (nodeId: string, jointId: string, value: number) => void;
  setKinematicJointValues: (nodeId: string, values: Record<string, number>) => void;
  resetKinematicPose: (nodeId: string) => void;
  updateKinematicJoint: (nodeId: string, jointId: string, patch: Partial<KinematicJoint>) => void;
  updateKinematicGraph: (nodeId: string, updater: (graph: KinematicGraph) => KinematicGraph, status: string) => void;
  startKinematicEdit: (nodeId: string, jointId: string, mode: KinematicEditTarget['mode']) => void;
  acceptKinematicJoint: (nodeId: string, jointId: string) => void;
  commitKinematicJointFrame: (nodeId: string, jointId: string) => void;
  rejectKinematicJoint: (nodeId: string, jointId: string) => void;
  deleteKinematicJoint: (nodeId: string, jointId: string) => void;
  createKinematicJoint: (nodeId: string, selectedPartNames: string[]) => void;
  saveKinematicConfiguration: () => void | Promise<void>;
  robotCursorGuideActive: boolean;
  toggleRobotCursorGuide: (nodeId: string) => void;
  randomizeGenerator: () => void;
};

const GeometryInspector = ({
  node,
  setGeometryValue,
  setImportedJointMotion,
  resetImportedJointPose,
  normalizeImportedModel,
  demoActive,
  toggleImportedMotionDemo,
  trainingCandidate,
  trainingProgress,
  startMotionTrainer,
  acceptMotionTest,
  rejectMotionTest,
  stopMotionTrainer,
  moveValidatedMotion,
  removeValidatedMotion,
  selectedPartNames,
  setKinematicJointValue,
  setKinematicJointValues,
  resetKinematicPose,
  updateKinematicJoint,
  updateKinematicGraph,
  startKinematicEdit,
  acceptKinematicJoint,
  commitKinematicJointFrame,
  rejectKinematicJoint,
  deleteKinematicJoint,
  createKinematicJoint,
  saveKinematicConfiguration,
  robotCursorGuideActive,
  toggleRobotCursorGuide,
  randomizeGenerator,
}: GeometryInspectorProps) => {
  const geometry = node.geometry;

  if (geometry.kind === 'box') {
    return (
      <section>
        <h3>Geometry</h3>
        <Slider label="Width" value={geometry.width} min={0.1} max={6} step={0.05} onChange={(value) => setGeometryValue('width', value)} />
        <Slider label="Height" value={geometry.height} min={0.1} max={5} step={0.05} onChange={(value) => setGeometryValue('height', value)} />
        <Slider label="Depth" value={geometry.depth} min={0.1} max={6} step={0.05} onChange={(value) => setGeometryValue('depth', value)} />
      </section>
    );
  }

  if (geometry.kind === 'sphere') {
    return (
      <section>
        <h3>Geometry</h3>
        <Slider label="Radius" value={geometry.radius} min={0.1} max={3} step={0.05} onChange={(value) => setGeometryValue('radius', value)} />
        <Slider label="Segments" value={geometry.segments} min={8} max={64} step={1} onChange={(value) => setGeometryValue('segments', value)} />
      </section>
    );
  }

  if (geometry.kind === 'cylinder') {
    return (
      <section>
        <h3>Geometry</h3>
        <Slider label="Radius" value={geometry.radius} min={0.1} max={3} step={0.05} onChange={(value) => setGeometryValue('radius', value)} />
        <Slider label="Height" value={geometry.height} min={0.1} max={5} step={0.05} onChange={(value) => setGeometryValue('height', value)} />
        <Slider label="Segments" value={geometry.segments} min={8} max={64} step={1} onChange={(value) => setGeometryValue('segments', value)} />
      </section>
    );
  }

  if (geometry.kind === 'plane') {
    return (
      <section>
        <h3>Geometry</h3>
        <Slider label="Width" value={geometry.width} min={0.1} max={8} step={0.05} onChange={(value) => setGeometryValue('width', value)} />
        <Slider label="Depth" value={geometry.depth} min={0.1} max={8} step={0.05} onChange={(value) => setGeometryValue('depth', value)} />
      </section>
    );
  }

  if (geometry.kind === 'imported-model') {
    const validatedMotions = [...(geometry.validatedMotions ?? [])].sort((a, b) => a.order - b.order);

    return (
      <section>
        <div className="section-title-row">
          <h3>Imported Model</h3>
          <div className="mini-actions">
            <button title="Factory reset" onClick={resetImportedJointPose}>
              <RotateCw size={16} />
            </button>
            <button title="Fit model to scene" onClick={normalizeImportedModel}>
              <Focus size={16} />
            </button>
          </div>
        </div>
        <div className="imported-summary">
          <span>{geometry.assetName}</span>
          <span>{geometry.sourceFormat.toUpperCase()}</span>
          <span>{geometry.joints.length} joints</span>
          <span>{geometry.animations.length} animations</span>
        </div>
        <div className="bounds-summary">
          <span>Original {(geometry.originalBounds ?? [0, 0, 0]).map((value) => value.toFixed(2)).join(' x ')}</span>
          <span>Scene {(geometry.normalizedBounds ?? [0, 0, 0]).map((value) => value.toFixed(2)).join(' x ')}</span>
          <span>Scale {(geometry.importScale ?? 1).toFixed(4)}</span>
        </div>
        <KinematicGraphPanel
          node={node}
          selectedPartNames={selectedPartNames}
          setKinematicJointValue={setKinematicJointValue}
          setKinematicJointValues={setKinematicJointValues}
          resetKinematicPose={resetKinematicPose}
          updateKinematicJoint={updateKinematicJoint}
          updateKinematicGraph={updateKinematicGraph}
          startKinematicEdit={startKinematicEdit}
          acceptKinematicJoint={acceptKinematicJoint}
          commitKinematicJointFrame={commitKinematicJointFrame}
          rejectKinematicJoint={rejectKinematicJoint}
          deleteKinematicJoint={deleteKinematicJoint}
          createKinematicJoint={createKinematicJoint}
          saveKinematicConfiguration={saveKinematicConfiguration}
          robotCursorGuideActive={robotCursorGuideActive}
          toggleRobotCursorGuide={toggleRobotCursorGuide}
        />
        <button className={demoActive ? 'smart-motion-button active' : 'smart-motion-button'} disabled={!geometry.joints.length} onClick={toggleImportedMotionDemo}>
          {demoActive ? <Pause size={16} /> : <Activity size={16} />}
          <span>{demoActive ? 'Stop Smart Demo' : validatedMotions.length ? 'Start Learned Demo' : 'Start Smart Demo'}</span>
        </button>

        <div className="motion-trainer">
          <div className="section-title-row">
            <h4>Motion Trainer</h4>
            <button title="Start movement tests" disabled={!geometry.joints.length} onClick={startMotionTrainer}>
              <Play size={15} />
            </button>
          </div>

          {trainingCandidate ? (
            <div className="active-motion-test">
              <span>{trainingProgress ? `${trainingProgress.current}/${trainingProgress.total}` : 'Test'}</span>
              <strong title={trainingCandidate.label}>{trainingCandidate.label}</strong>
              <div className="motion-test-actions">
                <button className="primary" title="Validate movement" onClick={acceptMotionTest}>
                  <Check size={15} />
                  <span>Validate</span>
                </button>
                <button title="Reject movement" onClick={rejectMotionTest}>
                  <X size={15} />
                  <span>Reject</span>
                </button>
                <button title="Stop tests" onClick={stopMotionTrainer}>
                  <Pause size={15} />
                </button>
              </div>
            </div>
          ) : (
            <button className="wide-action compact" disabled={!geometry.joints.length} onClick={startMotionTrainer}>
              <Play size={16} />
              <span>Start Tests</span>
            </button>
          )}

          {validatedMotions.length ? (
            <div className="validated-motion-list">
              {validatedMotions.map((motion, index) => (
                <div key={motion.id} className="validated-motion-row">
                  <span>{index + 1}</span>
                  <strong title={motion.label}>{motion.label}</strong>
                  <button title="Move earlier" disabled={index === 0} onClick={() => moveValidatedMotion(node.id, motion.id, -1)}>
                    <ArrowUp size={14} />
                  </button>
                  <button title="Move later" disabled={index === validatedMotions.length - 1} onClick={() => moveValidatedMotion(node.id, motion.id, 1)}>
                    <ArrowDown size={14} />
                  </button>
                  <button title="Remove movement" onClick={() => removeValidatedMotion(node.id, motion.id)}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {geometry.joints.length ? (
          <div className="joint-list">
            {geometry.joints.slice(0, 24).map((joint) => (
              <div key={joint.name} className="joint-row">
                <strong title={joint.name}>{joint.label ?? joint.name}</strong>
                <Slider
                  label={`${joint.motionKind === 'translation' ? 'Slide' : 'Rotate'} ${(joint.axis ?? 'x').toUpperCase()}`}
                  value={
                    joint.motionKind === 'translation'
                      ? joint.translation?.[joint.axis === 'y' ? 1 : joint.axis === 'z' ? 2 : 0] ?? 0
                      : joint.rotation[joint.axis === 'y' ? 1 : joint.axis === 'z' ? 2 : 0]
                  }
                  min={joint.min ?? -3.14}
                  max={joint.max ?? 3.14}
                  step={0.01}
                  onChange={(value) => setImportedJointMotion(joint.name, value)}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">This model has no skeleton. You can transform the whole object, but not pose articulations.</div>
        )}
      </section>
    );
  }

  if (geometry.kind === 'serialized-object') {
    return (
      <section>
        <h3>Stored Part</h3>
        <div className="metrics-list">
          <span>{geometry.assetName}</span>
          <span>
            Bounds {geometry.normalizedBounds.map((value) => value.toFixed(2)).join(' x ')}
          </span>
        </div>
      </section>
    );
  }

  const generator = getGeneratorDefinition(geometry.generatorId);

  if (!generator) {
    return (
      <section>
        <h3>Generator</h3>
        <div className="empty-state">Unknown generator definition.</div>
      </section>
    );
  }
  const generatedGraph = graphFromGeometry(geometry);
  const hasSeed = generator.parameters.some((parameter) => parameter.key === 'seed');

  return (
    <section>
      <div className="section-title-row">
        <h3>{generator.name}</h3>
        {hasSeed && (
          <button title="Randomize seed" onClick={randomizeGenerator}>
            <Sparkles size={16} />
          </button>
        )}
      </div>
      <p className="generator-description">{generator.description}</p>
      {generatedGraph && (
        <>
          <KinematicGraphPanel
            node={node}
            selectedPartNames={selectedPartNames}
            setKinematicJointValue={setKinematicJointValue}
            setKinematicJointValues={setKinematicJointValues}
            resetKinematicPose={resetKinematicPose}
            updateKinematicJoint={updateKinematicJoint}
            updateKinematicGraph={updateKinematicGraph}
            startKinematicEdit={startKinematicEdit}
            acceptKinematicJoint={acceptKinematicJoint}
            commitKinematicJointFrame={commitKinematicJointFrame}
            rejectKinematicJoint={rejectKinematicJoint}
            deleteKinematicJoint={deleteKinematicJoint}
            createKinematicJoint={createKinematicJoint}
            saveKinematicConfiguration={saveKinematicConfiguration}
            robotCursorGuideActive={robotCursorGuideActive}
            toggleRobotCursorGuide={toggleRobotCursorGuide}
          />
          <button className={demoActive ? 'smart-motion-button active' : 'smart-motion-button'} disabled={!generatedGraph.motionClips?.length} onClick={toggleImportedMotionDemo}>
            {demoActive ? <Pause size={16} /> : <Activity size={16} />}
            <span>{demoActive ? 'Stop Smart Demo' : 'Start Smart Demo'}</span>
          </button>
        </>
      )}
      {generator.parameters.map((parameter) =>
        parameter.key === 'seed' ? (
          <label className="field-row" key={parameter.key}>
            <span>{parameter.label}</span>
            <input type="number" value={geometry.params[parameter.key]} onChange={(event) => setGeometryValue(parameter.key, Number(event.target.value))} />
          </label>
        ) : (
          <Slider
            key={parameter.key}
            label={parameter.label}
            value={geometry.params[parameter.key]}
            min={parameter.min}
            max={parameter.max}
            step={parameter.step}
            onChange={(value) => setGeometryValue(parameter.key, value)}
          />
        ),
      )}
    </section>
  );
};
