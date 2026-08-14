using UnityEngine;

namespace RunToExit.Core
{
    public class ExitDoor : InteractableBase
    {
        public override bool IsObstacle(CharacterBase character) => false;

        public override void OnInteract(CharacterBase character)
        {
            if (character is NPCController npc && npc.IsRescued && !npc.IsEscaped)
            {
                npc.Escape();
            }
            if (GameManager.Instance != null)
            {
                GameManager.Instance.CheckClearCondition();
            }
        }

        private void Update()
        {
            // 毎フレーム、誰かが乗っているかチェックしてGameManagerに報告することも可能
        }
    }
}
