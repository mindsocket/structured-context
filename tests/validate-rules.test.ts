import { describe, expect, it } from 'bun:test';
import type { RulesMetadata, SpaceNode } from '../src/types';
import { validateRules } from '../src/validate-rules';

describe('validate-rules', () => {
  describe('validateRules', () => {
    const mockNodes: SpaceNode[] = [
      {
        label: 'outcome.md',
        schemaData: { title: 'Outcome', type: 'outcome', status: 'active', metric: 'Increase X' },
        linkTargets: ['Outcome'],
        resolvedParents: [],
        resolvedType: 'goal', // outcome is an alias for goal
      },
      {
        label: 'opportunity.md',
        schemaData: {
          title: 'Opportunity',
          type: 'opportunity',
          status: 'active',
          parent: '[[Outcome]]',
          source: 'Interview',
        },
        linkTargets: ['Opportunity'],
        resolvedParents: ['Outcome'],
        resolvedType: 'opportunity',
      },
      {
        label: 'solution.md',
        schemaData: { title: 'Solution', type: 'solution', status: 'exploring', parent: '[[Opportunity]]' },
        linkTargets: ['Solution'],
        resolvedParents: ['Opportunity'],
        resolvedType: 'solution',
      },
      {
        label: 'bad-solution.md',
        schemaData: { title: 'Bad Solution', type: 'solution', status: 'exploring', parent: '[[Solution]]' },
        linkTargets: ['Bad Solution'],
        resolvedParents: ['Solution'],
        resolvedType: 'solution',
      },
      {
        label: 'experiment.md',
        schemaData: {
          title: 'Experiment',
          type: 'experiment',
          status: 'exploring',
          parent: '[[Solution]]',
          assumption: 'Test',
        },
        linkTargets: ['Experiment'],
        resolvedParents: ['Solution'],
        resolvedType: 'experiment',
      },
      {
        label: 'bad-experiment.md',
        schemaData: {
          title: 'Bad Experiment',
          type: 'experiment',
          status: 'exploring',
          parent: '[[Opportunity]]',
          assumption: 'Test',
        },
        linkTargets: ['Bad Experiment'],
        resolvedParents: ['Opportunity'],
        resolvedType: 'experiment',
      },
    ];

    describe('validation rules', () => {
      const validationRules: RulesMetadata = {
        validation: [
          {
            id: 'solution-parent-type',
            description: 'Parent must be an opportunity',
            type: 'solution',
            check: '$exists(parent) = false or $exists(nodes[title=$$.current.parent and resolvedType="opportunity"])',
          },
          {
            id: 'experiment-parent-type',
            description: 'Parent must be a solution',
            type: 'experiment',
            check: '$exists(parent) and $exists(nodes[title=$$.current.parent and resolvedType="solution"])',
          },
          {
            id: 'outcome-no-parent',
            description: 'Outcome nodes should not have a parent',
            type: 'outcome',
            check: '$exists(parent) = false',
          },
        ],
      };

      it('passes validation when all rules are satisfied', async () => {
        const validNodes = mockNodes.filter((n) => n.label === 'solution.md');
        const violations = await validateRules(validNodes, validationRules);
        expect(violations).toHaveLength(0);
      });

      it('detects solution with non-opportunity parent', async () => {
        const badSolutionNode = mockNodes.find((n) => n.label === 'bad-solution.md');
        const parentNode = mockNodes.find((n) => n.label === 'solution.md');
        // Pass both nodes so the parent can be found in the index
        const violations = await validateRules([badSolutionNode!, parentNode!], validationRules);
        expect(violations).toHaveLength(1);
        expect(violations[0]?.ruleId).toBe('solution-parent-type');
        expect(violations[0]?.category).toBe('validation');
        expect(violations[0]?.file).toBe('bad-solution.md');
      });

      it('detects experiment with non-solution parent', async () => {
        const badExperimentNode = mockNodes.find((n) => n.label === 'bad-experiment.md');
        const parentNode = mockNodes.find((n) => n.label === 'opportunity.md');
        // Pass both nodes so the parent can be found in the index
        const violations = await validateRules([badExperimentNode!, parentNode!], validationRules);
        expect(violations).toHaveLength(1);
        expect(violations[0]?.ruleId).toBe('experiment-parent-type');
        expect(violations[0]?.category).toBe('validation');
      });

      it('detects outcome with parent', async () => {
        const outcomeWithParent: SpaceNode = {
          label: 'bad-outcome.md',
          schemaData: { title: 'Bad Outcome', type: 'outcome', status: 'active', parent: '[[Vision]]' },
          linkTargets: ['Bad Outcome'],
          resolvedParents: ['Vision'],
          resolvedType: 'outcome',
        };
        const visionNode: SpaceNode = {
          label: 'vision.md',
          schemaData: { title: 'Vision', type: 'vision', status: 'active' },
          linkTargets: ['Vision'],
          resolvedParents: [],
          resolvedType: 'vision',
        };
        // Pass both nodes so the parent can be found in the index
        const violations = await validateRules([outcomeWithParent, visionNode], validationRules);
        expect(violations).toHaveLength(1);
        expect(violations[0]?.ruleId).toBe('outcome-no-parent');
      });
    });

    describe('best-practice rules', () => {
      const bestPracticeRules: RulesMetadata = {
        bestPractice: [
          {
            id: 'solution-quantity',
            description: 'Explore multiple candidate solutions for the target opportunity',
            type: 'opportunity',
            check: '$count(nodes[resolvedParentTitle=$$.current.title and resolvedType="solution"]) >= 3',
          },
        ],
      };

      it('passes when opportunity has enough solutions', async () => {
        const opportunityNode: SpaceNode = {
          label: 'opportunity.md',
          schemaData: {
            title: 'Opportunity',
            type: 'opportunity',
            status: 'active',
            parent: '[[Outcome]]',
            source: 'Interview',
          },
          linkTargets: ['Opportunity'],
          resolvedParents: ['Outcome'],
          resolvedType: 'opportunity',
        };

        const solutions: SpaceNode[] = Array.from({ length: 3 }, (_, i) => ({
          label: `solution${i}.md`,
          schemaData: {
            title: `Solution ${i}`,
            type: 'solution',
            status: 'exploring',
            parent: '[[Opportunity]]',
          },
          linkTargets: [`Solution ${i}`],
          resolvedParents: ['Opportunity'],
          resolvedType: 'solution',
        }));

        const nodes = [opportunityNode, ...solutions];
        const violations = await validateRules(nodes, bestPracticeRules);
        expect(violations).toHaveLength(0);
      });

      it('detects opportunity with too few solutions', async () => {
        const opportunityNode: SpaceNode = {
          label: 'opportunity.md',
          schemaData: {
            title: 'Opportunity',
            type: 'opportunity',
            status: 'active',
            parent: '[[Outcome]]',
            source: 'Interview',
          },
          linkTargets: ['Opportunity'],
          resolvedParents: ['Outcome'],
          resolvedType: 'opportunity',
        };

        const singleSolution: SpaceNode = {
          label: 'solution.md',
          schemaData: { title: 'Solution', type: 'solution', status: 'exploring', parent: '[[Opportunity]]' },
          linkTargets: ['Solution'],
          resolvedParents: ['Opportunity'],
          resolvedType: 'solution',
        };

        const nodes = [opportunityNode, singleSolution];
        const violations = await validateRules(nodes, bestPracticeRules);
        expect(violations).toHaveLength(1);
        expect(violations[0]?.ruleId).toBe('solution-quantity');
        expect(violations[0]?.category).toBe('best-practice');
      });
    });

    describe('workflow rules', () => {
      const workflowRules: RulesMetadata = {
        workflow: [
          {
            id: 'active-outcome-count',
            description: 'Only one outcome should be active at a time',
            scope: 'global',
            check: '$count(nodes[resolvedType="outcome" and status="active"]) <= 1',
          },
          {
            id: 'active-node-parent-active',
            description: "An active node's parent should also be active",
            check: "current.status != 'active' or $exists(parent) = false or parent.status = 'active'",
          },
        ],
      };

      it('passes when only one outcome is active', async () => {
        const nodes = mockNodes.filter((n) => n.schemaData.type === 'outcome');
        const violations = await validateRules(nodes, workflowRules);
        expect(violations).toHaveLength(0);
      });

      it('detects multiple active outcomes (global scope)', async () => {
        const multipleActiveOutcomes: SpaceNode[] = [
          {
            label: 'outcome1.md',
            schemaData: { title: 'Outcome 1', type: 'outcome', status: 'active', metric: 'X' },
            linkTargets: ['Outcome 1'],
            resolvedParents: [],
            resolvedType: 'outcome',
          },
          {
            label: 'outcome2.md',
            schemaData: { title: 'Outcome 2', type: 'outcome', status: 'active', metric: 'Y' },
            linkTargets: ['Outcome 2'],
            resolvedParents: [],
            resolvedType: 'outcome',
          },
          {
            label: 'unrelated.md',
            schemaData: { title: 'Unrelated', type: 'solution', status: 'exploring' },
            linkTargets: ['Unrelated'],
            resolvedParents: [],
            resolvedType: 'solution',
          },
        ];
        const activeCountViolations = await validateRules(multipleActiveOutcomes, {
          workflow: [workflowRules.workflow![0]!],
        });
        expect(activeCountViolations).toHaveLength(1); // global rule produces one violation regardless of node count
        expect(activeCountViolations[0]?.ruleId).toBe('active-outcome-count');
        expect(activeCountViolations[0]?.category).toBe('workflow');
        expect(activeCountViolations[0]?.file).toBe('');
      });

      it('detects active node with non-active parent', async () => {
        const parentNode: SpaceNode = {
          label: 'outcome.md',
          schemaData: { title: 'Outcome', type: 'outcome', status: 'inactive', metric: 'X' },
          linkTargets: ['Outcome'],
          resolvedParents: [],
          resolvedType: 'outcome',
        };
        const childNode: SpaceNode = {
          label: 'opportunity.md',
          schemaData: {
            title: 'Opportunity',
            type: 'opportunity',
            status: 'active',
            parent: '[[Outcome]]',
            source: 'Interview',
          },
          linkTargets: ['Opportunity'],
          resolvedParents: ['Outcome'],
          resolvedType: 'opportunity',
        };
        const violations = await validateRules([parentNode, childNode], { workflow: [workflowRules.workflow![1]!] });
        expect(violations).toHaveLength(1);
        expect(violations[0]?.ruleId).toBe('active-node-parent-active');
        expect(violations[0]?.category).toBe('workflow');
        expect(violations[0]?.file).toBe('opportunity.md');
      });

      it('passes active node when parent is also active', async () => {
        const parentNode: SpaceNode = {
          label: 'outcome.md',
          schemaData: { title: 'Outcome', type: 'outcome', status: 'active', metric: 'X' },
          linkTargets: ['Outcome'],
          resolvedParents: [],
          resolvedType: 'outcome',
        };
        const childNode: SpaceNode = {
          label: 'opportunity.md',
          schemaData: {
            title: 'Opportunity',
            type: 'opportunity',
            status: 'active',
            parent: '[[Outcome]]',
            source: 'Interview',
          },
          linkTargets: ['Opportunity'],
          resolvedParents: ['Outcome'],
          resolvedType: 'opportunity',
        };
        const violations = await validateRules([parentNode, childNode], { workflow: [workflowRules.workflow![1]!] });
        expect(violations).toHaveLength(0);
      });
    });

    describe('mixed categories', () => {
      const mixedRules: RulesMetadata = {
        validation: [
          {
            id: 'solution-parent-type',
            description: 'Parent must be an opportunity',
            type: 'solution',
            check: '$exists(parent) = false or $exists(nodes[title=$$.current.parent and resolvedType="opportunity"])',
          },
        ],
        workflow: [
          {
            id: 'active-outcome-count',
            description: 'Only one outcome should be active at a time',
            scope: 'global',
            check: '$count(nodes[resolvedType="outcome" and status="active"]) <= 1',
          },
        ],
      };

      it('collects violations from multiple categories', async () => {
        const nodes: SpaceNode[] = [
          {
            label: 'outcome1.md',
            schemaData: { title: 'Outcome 1', type: 'outcome', status: 'active', metric: 'X' },
            linkTargets: ['Outcome 1'],
            resolvedParents: [],
            resolvedType: 'outcome',
          },
          {
            label: 'outcome2.md',
            schemaData: { title: 'Outcome 2', type: 'outcome', status: 'active', metric: 'Y' },
            linkTargets: ['Outcome 2'],
            resolvedParents: [],
            resolvedType: 'outcome',
          },
          {
            label: 'solution.md',
            schemaData: { title: 'Solution', type: 'solution', status: 'exploring', parent: '[[Opportunity]]' },
            linkTargets: ['Solution'],
            resolvedParents: ['Opportunity'],
            resolvedType: 'solution',
          },
          {
            label: 'bad-solution.md',
            schemaData: { title: 'Bad Solution', type: 'solution', status: 'exploring', parent: '[[Solution]]' },
            linkTargets: ['Bad Solution'],
            resolvedParents: ['Solution'],
            resolvedType: 'solution',
          },
        ];

        const violations = await validateRules(nodes, mixedRules);
        expect(violations.length).toBeGreaterThan(0);

        const validationViolations = violations.filter((v) => v.category === 'validation');
        const workflowViolations = violations.filter((v) => v.category === 'workflow');

        expect(validationViolations.length).toBeGreaterThan(0);
        expect(workflowViolations.length).toBeGreaterThan(0);
      });
    });
  });
});
