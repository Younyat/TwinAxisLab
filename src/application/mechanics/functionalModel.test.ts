import type { KinematicGraph } from '../../domain/kinematics';
import type { MaterialDefinition } from '../../domain/model';
import { buildFunctionalAssembly, buildFunctionalComponent, buildMechanicalAdjacencyGraph } from './functionalModel';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const material: MaterialDefinition = {
  name: 'Fixture steel',
  color: '#a0a0a0',
  roughness: 0.5,
  metalness: 0.4,
};

const sourceGraph = (): KinematicGraph => ({
  rootPartId: 'base',
  analysisVersion: 'm2-fixture/1.0',
  parts: [
    { id: 'base', name: 'Base', meshObjectIds: ['Base'], localFrame: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, bounds: { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1], center: [0.5, 0.5, 0.5] }, static: true, visible: true, source: 'automatic-segmentation', metadata: {} },
    { id: 'link', name: 'Link', meshObjectIds: ['Link'], localFrame: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, bounds: { min: [1, 0, 0], max: [3, 1, 1], size: [2, 1, 1], center: [2, 0.5, 0.5] }, static: false, visible: true, source: 'automatic-segmentation', metadata: {} },
  ],
  joints: [{
    id: 'joint-base-link', name: 'Base hinge', parentPartId: 'base', childPartId: 'link', type: 'revolute',
    origin: { position: [1, 0.5, 0.5], rotation: [0, 0, 0, 1] }, axis: [0, 0, 1], limits: { lower: -1.5, upper: 1.5 },
    source: 'geometry', confidence: 0.9, evidence: [{ type: 'geometry', score: 0.9, message: 'Synthetic coaxial fixture.' }], status: 'validated',
  }],
});

export const runFunctionalModelTests = () => {
  const graph = sourceGraph();
  const adjacency = buildMechanicalAdjacencyGraph(graph);
  assert(adjacency.length === 1, 'Pre-dismantle analysis did not create one mechanical adjacency.');
  assert(adjacency[0].minimumDistance === 0, 'Touching parts did not retain zero AABB distance.');
  assert(adjacency[0].coaxialCandidates.length === 1, 'Joint evidence did not create a coaxial candidate.');
  assert(adjacency[0].coaxialCandidates[0].axisDirection[2] === 1, 'Coaxial candidate lost the joint axis.');

  const base = buildFunctionalComponent({ id: 'component-base', name: 'Base', category: 'robots', className: 'base', sourceAssetName: 'fixture.glb', sourceObjectName: 'Base', bounds: [1, 1, 1], material, sourceGraph: graph });
  const link = buildFunctionalComponent({ id: 'component-link', name: 'Link', category: 'robots', className: 'link', sourceAssetName: 'fixture.glb', sourceObjectName: 'Link', bounds: [2, 1, 1], material, sourceGraph: graph });
  assert(base.kinematicGraph.mechanicalAdjacency?.length === 1 && link.kinematicGraph.mechanicalAdjacency?.length === 1, 'Dismantled components lost external mechanical adjacency evidence.');

  const reloaded = JSON.parse(JSON.stringify([base, link])) as [typeof base, typeof link];
  const assembly = buildFunctionalAssembly({ id: 'assembly-reloaded', name: 'Reloaded coaxial assembly', components: reloaded, source: 'reassembly' });
  assert(assembly.connections.length === 1, 'Reloaded components did not reconstruct their connection.');
  assert(assembly.connections[0].metadata.mechanicalAdjacency === true, 'Reconstructed connection did not use preserved adjacency evidence.');
  assert(assembly.connections[0].joint.origin.position[0] === 1, 'Reconstructed coaxial origin changed after reload.');
  assert(assembly.connections[0].joint.axis[2] === 1, 'Reconstructed coaxial axis changed after reload.');
  assert(assembly.kinematicGraph.mechanicalAdjacency?.[0]?.partA === 'component-base', 'Assembly graph did not remap source part adjacency to component IDs.');
  assert(assembly.kinematicGraph.mechanicalAdjacency?.[0]?.metadata?.restoredAfterDismantle === true, 'Assembly adjacency does not identify its restored provenance.');
  console.log('Mechanical adjacency M2-F tests passed: analyze, dismantle, JSON reload and coaxial reassembly.');
};
