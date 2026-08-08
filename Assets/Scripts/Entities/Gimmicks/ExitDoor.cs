using UnityEngine;

namespace RunToExit.Core
{
    public class ExitDoor : InteractableBase
    {
        public override bool IsObstacle(CharacterBase character) => false;

        public override void OnInteract(CharacterBase character)
        {
            // 自動で拾うような処理はしない。
            // 到達判定はGameManager側で Update などを回して判定するか、ここで判定を呼ぶ
            if (character is PlayerController)
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
