using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace RunToExit.Core
{
    public class MoveCommand : ICommand
    {
        private Vector2Int targetPos;

        public MoveCommand(Vector2Int target)
        {
            targetPos = target;
        }

        public IEnumerator ExecuteCoroutine(CharacterBase character)
        {
            // パスファインディングを使用して経路を取得
            List<Vector2Int> path = Pathfinder.FindPath(character, character.GridPosition, targetPos);
            if (path == null || path.Count == 0)
            {
                Debug.Log($"{character.gameObject.name} cannot find a path to {targetPos}");
                yield break;
            }

            foreach (var step in path)
            {
                if (character.State != CharacterBase.CharacterState.Idle)
                {
                    while (character.State != CharacterBase.CharacterState.Idle) yield return null;
                }

                // 進行方向を計算
                int dirX = step.x > character.GridPosition.x ? 1 : (step.x < character.GridPosition.x ? -1 : 0);
                int dirY = step.y - character.GridPosition.y;

                if (dirY != 0)
                {
                    if (dirX == 0)
                    {
                        // 垂直移動＝ハシゴ
                        if (!character.TryClimbLadder(dirY)) yield break;
                    }
                    else
                    {
                        // 斜め移動＝階段 or 段差
                        bool hasStairs = GridManager.Instance.GetNode(character.GridPosition).GetEntity<Stairs>() != null || 
                                         GridManager.Instance.GetNode(step).GetEntity<Stairs>() != null;
                        
                        if (hasStairs)
                        {
                            if (!character.TryMoveStairs(step)) yield break;
                        }
                        else
                        {
                            if (dirY > 0)
                            {
                                if (!character.TryStepUp(step)) yield break;
                            }
                            else
                            {
                                // 落下を伴う移動（飛び降りなど）はとりあえず横移動として扱い、CheckFallに任せる
                                if (!character.TryMove(dirX)) yield break;
                            }
                        }
                    }
                }
                else if (Mathf.Abs(step.x - character.GridPosition.x) > 1)
                {
                    if (!character.TryLongJump(dirX)) yield break;
                }
                else
                {
                    if (!character.TryMove(dirX)) yield break;
                }

                // 次の移動まで待機
                while (character.State != CharacterBase.CharacterState.Idle) yield return null;
            }
        }
    }
}
